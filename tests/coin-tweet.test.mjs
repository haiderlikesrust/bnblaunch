import test from 'node:test';
import assert from 'node:assert/strict';
import {coinTweetUrl} from '../lib/coin-tweet.ts';

test('coin tweet is optional and normalizes only X post links',()=>{
 assert.equal(coinTweetUrl.parse(undefined),'');
 assert.equal(coinTweetUrl.parse('  '),'');
 assert.equal(coinTweetUrl.parse(' https://twitter.com/shendotnow/status/12345?s=20#test '),'https://x.com/shendotnow/status/12345');
 assert.equal(coinTweetUrl.parse('https://www.x.com/i/status/12345/'),'https://x.com/i/status/12345');
 for(const value of ['https://x.com/shendotnow','https://evil.test/a/status/1','https://x.com.evil.test/a/status/1','http://x.com/a/status/1','javascript:alert(1)','https://user:pass@x.com/a/status/1','https://x.com:444/a/status/1','https://x.com/a/status/nope',123,null])assert.equal(coinTweetUrl.safeParse(value).success,false,String(value));
});
