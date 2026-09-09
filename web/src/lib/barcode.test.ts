import {expect,it} from 'vitest';
import {barcodeCrop} from './barcode';

it('maps a landscape source cropped to a portrait viewport',()=>{
  expect(barcodeCrop(1280,720,{left:20,top:30,width:300,height:400},{left:50,top:180,width:240,height:100}))
    .toEqual({x:expect.closeTo(424),y:270,width:expect.closeTo(432),height:180});
});
it('maps a portrait source cropped to a landscape viewport',()=>{
  expect(barcodeCrop(720,1280,{left:0,top:0,width:400,height:300},{left:40,top:100,width:320,height:100}))
    .toEqual({x:72,y:550,width:576,height:180});
});
it('does not scan before video metadata or outside the source',()=>{
  expect(barcodeCrop(0,0,{left:0,top:0,width:300,height:400},{left:0,top:0,width:10,height:10})).toBeNull();
  expect(barcodeCrop(100,100,{left:0,top:0,width:100,height:100},{left:200,top:0,width:10,height:10})).toBeNull();
});
