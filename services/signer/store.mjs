import { DatabaseSync } from 'node:sqlite';
import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual, randomUUID } from 'node:crypto';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { isAddress, keccak256, parseTransaction, recoverTransactionAddress } from 'viem';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function loadMasterKey(value) {
  if (!/^[a-fA-F0-9]{64}$/.test(value ?? '')) throw Error('SIGNER_MASTER_KEY must be a 32-byte hex key supplied through a secret manager.');
  return Buffer.from(value, 'hex');
}
export function authenticate(actual, expected) {
  if (!expected || expected.length < 40 || typeof actual !== 'string') return false;
  const a = Buffer.from(actual), b = Buffer.from('Bearer ' + expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

// Broadcast only bytes read from this durable journal after a fenced commit.
export class WalletStore {
  constructor(path, masterKey) {
    this.key = loadMasterKey(masterKey);
    this.db = new DatabaseSync(path);
    const version=this.db.prepare('PRAGMA user_version').get().user_version;
    if(version!==0&&version!==1){this.db.close();throw Error('Unsupported signer database version');}
    const existing=this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='wallets'").get();
    if(existing&&version===0){this.db.close();throw Error('Unversioned signer database requires an explicit offline migration');}
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS metadata (id TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS wallets (coin_id TEXT PRIMARY KEY,address TEXT UNIQUE NOT NULL,sealed_key TEXT NOT NULL,token_address TEXT UNIQUE,launch_hash TEXT UNIQUE,lock_id TEXT,lock_until INTEGER,created_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS intents (id TEXT PRIMARY KEY,coin_id TEXT NOT NULL REFERENCES wallets(coin_id),request TEXT NOT NULL,kind TEXT NOT NULL,amount_wei TEXT NOT NULL,expires_at INTEGER NOT NULL,status TEXT NOT NULL,raw_tx TEXT,tx_hash TEXT UNIQUE,nonce INTEGER,gas_wei TEXT,receipt_block TEXT,receipt_hash TEXT,signed_at INTEGER,created_at INTEGER NOT NULL);
      CREATE UNIQUE INDEX IF NOT EXISTS intents_wallet_nonce ON intents(coin_id,nonce);
      CREATE UNIQUE INDEX IF NOT EXISTS intents_pending_wallet ON intents(coin_id) WHERE status IN ('signed','broadcast');
      PRAGMA user_version=1;`);
    try {
      const check = this.db.prepare("SELECT value FROM metadata WHERE id='key-check'").get();
      if (check) { if (this.open(check.value, 'master-key-check') !== 'SHEN signer') throw Error('Wrong master key'); }
      else this.db.prepare("INSERT INTO metadata(id,value) VALUES('key-check',?)").run(this.seal('SHEN signer', 'master-key-check'));
    } catch (error) { this.db.close(); throw error; }
  }
  seal(value, aad) {
    const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', this.key, iv);
    cipher.setAAD(Buffer.from(aad));
    const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    return JSON.stringify({ v: 1, iv: iv.toString('base64'), ciphertext: encrypted.toString('base64'), tag: cipher.getAuthTag().toString('base64') });
  }
  open(value, aad) {
    const box = JSON.parse(value);
    if (box.v !== 1) throw Error('Unsupported key version');
    const cipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(box.iv, 'base64'));
    cipher.setAAD(Buffer.from(aad)); cipher.setAuthTag(Buffer.from(box.tag, 'base64'));
    return Buffer.concat([cipher.update(Buffer.from(box.ciphertext, 'base64')), cipher.final()]).toString('utf8');
  }
  wallet(id) { return this.db.prepare('SELECT * FROM wallets WHERE coin_id=?').get(id); }
  provision(coinId) {
    if (!UUID.test(coinId)) throw Error('Invalid coin ID');
    this.db.exec('BEGIN IMMEDIATE');
    try {
      let row = this.wallet(coinId);
      if (!row) {
        const key = generatePrivateKey(), address = privateKeyToAccount(key).address;
        this.db.prepare('INSERT INTO wallets(coin_id,address,sealed_key,created_at) VALUES(?,?,?,?)').run(coinId, address, this.seal(key, `wallet:v1:56:${coinId}:${address}`), Date.now());
        row = this.wallet(coinId);
      }
      this.db.exec('COMMIT');
      return { coinId, address: row.address, chainId: 56 };
    } catch (e) { this.db.exec('ROLLBACK'); throw e; }
  }
  account(id) {
    const row = this.wallet(id);
    if (!row) throw Error('Wallet not found');
    return privateKeyToAccount(this.open(row.sealed_key, `wallet:v1:56:${id}:${row.address}`));
  }
  bindLaunch(id, token, hash) {
    if (!isAddress(token) || !/^0x[0-9a-f]{64}$/i.test(hash)) throw Error('Invalid launch');
    const row = this.wallet(id);
    if (!row) throw Error('Wallet not found');
    if (row.token_address && (row.token_address.toLowerCase() !== token.toLowerCase() || row.launch_hash !== hash)) throw Error('Launch binding is permanent');
    this.db.prepare('UPDATE wallets SET token_address=?,launch_hash=? WHERE coin_id=? AND token_address IS NULL').run(token, hash, id);
    const saved = this.wallet(id);
    if (saved.token_address.toLowerCase() !== token.toLowerCase() || saved.launch_hash !== hash) throw Error('Launch binding changed');
  }
  intent(id) { return this.db.prepare('SELECT * FROM intents WHERE id=?').get(id); }
  expireUnsigned(id) { this.db.prepare("UPDATE intents SET status='expired' WHERE id=? AND status='created' AND expires_at<=?").run(id,Date.now()); }
  createIntent({ id, coinId, kind, amountWei, expiresAt }) {
    if (!UUID.test(id) || !UUID.test(coinId) || !['compute', 'buyback', 'burn', 'reward'].includes(kind) || !/^\d{1,78}$/.test(amountWei) || BigInt(amountWei) <= 0n) throw Error('Invalid intent');
    const request = JSON.stringify({ coinId, kind, amountWei });
    const prior = this.intent(id);
    if (prior) { if (prior.request !== request) throw Error('Intent is immutable'); return prior; }
    if (!Number.isSafeInteger(expiresAt) || expiresAt <= Date.now() || expiresAt > Date.now() + 300000) throw Error('Invalid intent expiry');
    if (!this.wallet(coinId)?.token_address) throw Error('Launch must be confirmed');
    this.db.prepare("INSERT INTO intents(id,coin_id,request,kind,amount_wei,expires_at,status,created_at) VALUES(?,?,?,?,?,?,'created',?) ON CONFLICT(id) DO NOTHING").run(id, coinId, request, kind, amountWei, expiresAt, Date.now());
    const saved = this.intent(id);
    if (saved.request !== request) throw Error('Intent is immutable');
    return saved;
  }
  acquire(coinId) {
    const fence = randomUUID(), now = Date.now();
    const result = this.db.prepare('UPDATE wallets SET lock_id=?,lock_until=? WHERE coin_id=? AND (lock_until IS NULL OR lock_until<?)').run(fence, now + 120000, coinId, now);
    if (result.changes !== 1) throw Error('Wallet is processing another operation');
    return fence;
  }
  release(coinId, fence) { this.db.prepare('UPDATE wallets SET lock_id=NULL,lock_until=NULL WHERE coin_id=? AND lock_id=?').run(coinId, fence); }
  pending(coinId) { return this.db.prepare("SELECT * FROM intents WHERE coin_id=? AND status IN ('signed','broadcast')").get(coinId); }
  recentSpend(coinId) {
    return this.db.prepare("SELECT amount_wei,kind,gas_wei,status FROM intents WHERE coin_id=? AND signed_at>?").all(coinId, Date.now() - 86400000)
      .reduce((sum, r) => sum + (r.kind === 'burn'||r.status==='reverted' ? 0n : BigInt(r.amount_wei)) + BigInt(r.gas_wei ?? 0), 0n);
  }
  async persistSigned(id, fence, raw, expected) {
    const row = this.intent(id), wallet = row && this.wallet(row.coin_id);
    if (!row || !wallet || row.status !== 'created') throw Error('Intent is not signable');
    const tx = parseTransaction(raw), sender = await recoverTransactionAddress({ serializedTransaction: raw });
    if (tx.chainId !== 56 || tx.type !== 'legacy' || sender.toLowerCase() !== wallet.address.toLowerCase() || tx.to?.toLowerCase() !== expected.to.toLowerCase()
      || (tx.value ?? 0n) !== expected.value || (tx.data ?? '0x') !== expected.data || tx.nonce !== expected.nonce || tx.gas !== expected.gas || tx.gasPrice !== expected.gasPrice) throw Error('Signed transaction differs from validated intent');
    const hash = keccak256(raw), gas = tx.gas * tx.gasPrice;
    const saved = this.db.prepare(`UPDATE intents SET raw_tx=?,tx_hash=?,nonce=?,gas_wei=?,signed_at=?,status='signed'
      WHERE id=? AND status='created' AND expires_at>? AND EXISTS(SELECT 1 FROM wallets WHERE coin_id=intents.coin_id AND lock_id=? AND lock_until>?)`)
      .run(this.seal(raw, `transaction:${id}`), hash, tx.nonce, gas.toString(), Date.now(), id, Date.now(), fence, Date.now());
    if (saved.changes !== 1) throw Error('Signing lease or intent expired; transaction was not persisted');
    return hash;
  }
  signedBytes(id) { const row = this.intent(id); return row?.raw_tx ? this.open(row.raw_tx, `transaction:${id}`) : null; }
  broadcast(id) { this.db.prepare("UPDATE intents SET status='broadcast' WHERE id=? AND status='signed'").run(id); }
  finish(id, receipt) {
    this.db.prepare("UPDATE intents SET status=?,receipt_block=?,receipt_hash=? WHERE id=? AND status IN ('signed','broadcast')").run(receipt.status === 'success' ? 'confirmed' : 'reverted', receipt.blockNumber.toString(), receipt.blockHash, id);
  }
  close() { this.db.close(); }
}
