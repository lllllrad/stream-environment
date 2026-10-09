import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Ajv } from 'ajv';
import addFormats from 'ajv-formats';
import { setup, apply, now, event, change } from './helpers.ts';
import { operator } from '../src/domain/engine.ts';
const ajv = new Ajv({strict:true,allErrors:true});
(addFormats as unknown as (a:Ajv)=>void)(ajv);
const publicSchema=ajv.compile(JSON.parse(readFileSync('contracts/public-snapshot.schema.json','utf8')));
const receiptSchema=ajv.compile(JSON.parse(readFileSync('contracts/change-receipt.schema.json','utf8')));
test('public response schemas validate all presets, hold/hidden and selected auxiliary items',()=>{
  const {store,engine:e,producer:p,session:s}=setup();
  apply(e,p,s.id,[now(),event(),{op:'set_pin',value:{text:'Notice',expiresAt:null}},{op:'upsert_work_item',workItem:{id:'work',title:'Work',status:'failed',publicResult:'Public explanation'}}]);
  for(const id of ['main-full','main-side','main-lower']) assert.ok(publicSchema(e.output(id).snapshot),ajv.errorsText(publicSchema.errors));
  e.selectWork(s.id,{workItemId:'work',expectedRevision:e.session(s.id).revision});
  assert.equal(e.output('main-side').snapshot.content!.pin,undefined);
  assert.equal(e.output('main-side').snapshot.content!.workItem!.id,'work');
  for(const mode of ['hold','hidden'] as const) {e.setControl({expectedControlRevision:e.control().controlRevision,mode});for(const id of ['main-full','main-side','main-lower']) assert.ok(publicSchema(e.output(id).snapshot),ajv.errorsText(publicSchema.errors));}
  const receipt=apply(e,p,s.id,[now('Stored while hidden')]);assert.ok(receiptSchema(receipt),ajv.errorsText(receiptSchema.errors));store.close();
});
test('public schema refuses private fields and lower-preset content that must not be transmitted',()=>{
  const {store,engine:e,producer:p,session:s}=setup();apply(e,p,s.id,[now()]);
  const lower=e.output('main-lower').snapshot;
  assert.equal(publicSchema({...lower,token:'private'}),false);
  assert.equal(publicSchema({...lower,content:{...lower.content,goal:'MUST_NOT_SEND'}}),false);
  assert.equal(publicSchema({...lower,content:{...lower.content,now:{...lower.content!.now,detail:'MUST_NOT_SEND'}}}),false);store.close();
});
test('notice clearing overrides hold; prepared session changes report not_applicable',()=>{
  const {store,engine:e,producer:p,session:s}=setup();
  apply(e,p,s.id,[{op:'set_pin',value:{text:'Withdraw this notice',expiresAt:null}}]);e.setControl({expectedControlRevision:e.control().controlRevision,mode:'hold'});
  apply(e,p,s.id,[{op:'set_pin',value:null}]);assert.equal(e.output('main-full').snapshot.content!.pin,undefined);
  const prepared=e.createSession({title:'Future',goal:'Not currently published',expectedControlRevision:e.control().controlRevision});
  const receipt=e.changes(operator,prepared.id,change(prepared,[now()]));assert.equal(receipt.publication,'not_applicable');store.close();
});
