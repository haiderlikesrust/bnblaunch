import test from 'node:test';
import assert from 'node:assert/strict';
import {register} from 'node:module';
register('./runtime-loader.mjs',import.meta.url);
const env=globalThis.__shenTestEnv={};
const {videoConfig,videoModel}=await import('../lib/higgsfield.ts');

test('image-only animation defaults to Kling and keeps its five-second body',()=>{
 assert.deepEqual(videoConfig(),{model:'kling'});
 assert.equal(videoModel(videoConfig()).body('https://cdn.example.com/coin.png','Wave').duration,5);
});
test('Genjutsu requires a usable reference and sends the documented motion-transfer body',()=>{
 env.HIGGSFIELD_VIDEO_MODEL='genjutsu';
 assert.equal(videoConfig(),null);
 for(const bad of ['http://cdn.example.com/clip.mp4','https://localhost/clip.mp4','https://127.0.0.1/clip.mp4']){
  env.HIGGSFIELD_MOTION_REFERENCE_URL=bad;assert.equal(videoConfig(),null);
 }
 env.HIGGSFIELD_MOTION_REFERENCE_URL='https://cdn.example.com/clip.mp4';
 const config=videoConfig(),model=videoModel(config),body=model.body('https://cdn.example.com/coin.png','A friendly wave.');
 assert.equal(model.path,'/higgsfield/genjutsu/motion-transfer/v1.0');
 assert.equal(body.video_url,config.referenceUrl);assert.deepEqual(body.image_urls,['https://cdn.example.com/coin.png']);
 assert.equal(body.resolution,'720p');assert.equal(body.duration,undefined);assert.equal(body.sound,undefined);
 env.HIGGSFIELD_MOTION_REFERENCE_URL='https://cdn.example.com/changed.mp4';
 assert.equal(videoModel(config).body('https://cdn.example.com/coin.png','Wave').video_url,'https://cdn.example.com/clip.mp4');
 env.HIGGSFIELD_GENJUTSU_RESOLUTION='4k';assert.equal(videoConfig(),null);
 env.HIGGSFIELD_VIDEO_MODEL='typo';assert.equal(videoConfig(),null);
});
