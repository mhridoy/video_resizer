import test from 'node:test';
import assert from 'node:assert/strict';
import {VISION_LABELS,interpretLocalVision} from '../shared/local-vision.mjs';
const scores=(first,second,index=0)=>VISION_LABELS.map(([label],i)=>({label,score:i===index?first:i===(index+1)%VISION_LABELS.length?second:0}));
test('uncertain loading estimates keep photos without assigning a stage',()=>{
  assert.equal(interpretLocalVision(scores(.55,.44)).stage,'');
  assert.equal(interpretLocalVision(scores(.86,.6)).stage,'');
  assert.equal(interpretLocalVision([]).stage,'');
});
test('strong local matches map to stages, closed doors never imply fully loaded',()=>{
  for(let i=0;i<5;i++) assert.equal(interpretLocalVision(scores(.96,.02,i)).stage,i*25);
  assert.equal(interpretLocalVision(scores(.96,.02,5)).category,'closed');
  assert.equal(interpretLocalVision(scores(.96,.02,5)).stage,'');
  assert.equal(interpretLocalVision(scores(.6,.3,6)).category,'photos');
  assert.equal(interpretLocalVision(scores(.75,.2,6)).category,'seals');
});
