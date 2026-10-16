import {expect,it,vi} from 'vitest';
const native=vi.hoisted(()=>({readIncomingImage:vi.fn()}));
vi.mock('@capacitor/core',()=>({Capacitor:{},registerPlugin:()=>native}));
import {readIncomingImage} from './nativeIncomingImage';

it('preserves every byte and MIME type when decoding a large shared photo',async()=>{
  const original=Uint8Array.from({length:2*1024*1024},(_,index)=>index%256);
  const binary=String.fromCharCode(...Array.from({length:256},(_,index)=>index)).repeat(8192);
  native.readIncomingImage.mockResolvedValue({base64:btoa(binary)});
  const file=await readIncomingImage({id:'photo',mime:'image/jpeg',size:original.length,createdAt:0});
  expect(native.readIncomingImage).toHaveBeenCalledWith({id:'photo'});
  expect(file.type).toBe('image/jpeg');
  expect(file.size).toBe(original.length);
  const actual=new Uint8Array(await file.arrayBuffer());
  expect(actual.every((value,index)=>value===original[index])).toBe(true);
});
