import {useEffect,useRef} from 'react';
import {frameTask} from '../../lib/frameTask';

export function useFrameTask<T>(apply:(value:T)=>void) {
  const latest=useRef(apply);
  latest.current=apply;
  const task=useRef<ReturnType<typeof frameTask<T>>|null>(null);
  if(!task.current)task.current=frameTask<T>(value=>latest.current(value));
  useEffect(()=>()=>task.current?.cancel(),[]);
  return task.current;
}
