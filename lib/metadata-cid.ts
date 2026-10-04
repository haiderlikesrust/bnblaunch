import { CID } from 'multiformats/cid';
import { z } from 'zod';

// A CID prefix encodes the codec too: raw blocks start bafk, not bafy.
// Parse the complete identifier rather than guessing its codec from a prefix.
export const metadataCid=z.string().min(1).max(256).refine(value=>{
 try{const cid=CID.parse(value);return (cid.version===0||cid.version===1)&&cid.multihash.size>0}catch{return false}
},'Invalid metadata content identifier. Validate the launch again to upload fresh metadata.');
