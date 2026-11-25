import {useCallback,useEffect,useRef,useState} from 'react';
import {api} from '../../lib/api';
import type {BodyPage,BodyRecord} from '../../types';

export function useBodyPages(enabled:boolean,photosOnly=false){
  const [page,setPage]=useState<BodyPage>();
  const [error,setError]=useState('');
  const [loading,setLoading]=useState(false);
  const current=useRef<BodyPage>(undefined);
  const request=useRef(0);
  const running=useRef(false);

  const load=useCallback(async(refresh=false,limit=20):Promise<BodyRecord[]>=>{
    if(running.current&&!refresh)return [];
    const previous=current.current;
    if(!refresh&&!previous?.nextCursor)return [];
    const id=++request.current;
    running.current=true;
    setLoading(true);
    setError('');
    try{
      const minimum=refresh?previous?.records.length??0:0;
      let cursor=refresh?null:previous!.nextCursor;
      let result:BodyPage;
      const incoming=new Map<string,BodyRecord>();
      do{
        const query=new URLSearchParams({limit:String(Math.max(limit,Math.min(100,minimum-incoming.size)))});
        if(photosOnly)query.set('photosOnly','true');
        if(cursor)query.set('cursor',cursor);
        result=await api<BodyPage>('/body-records?'+query);
        if(id!==request.current)return [];
        result.records.forEach(record=>incoming.set(record.id,record));
        if(cursor&&result.nextCursor===cursor)throw new Error('The next page could not be loaded.');
        cursor=result.nextCursor;
      }while(cursor&&incoming.size<minimum);
      const records=new Map((refresh?[]:previous!.records).map(record=>[record.id,record]));
      incoming.forEach(record=>records.set(record.id,record));
      current.current={...result,records:[...records.values()]};
      setPage(current.current);
      return [...incoming.values()];
    }catch(ex){
      if(id===request.current)setError((ex as Error).message);
      return [];
    }finally{
      if(id===request.current){running.current=false;setLoading(false);}
    }
  },[photosOnly]);

  useEffect(()=>{
    if(enabled&&!current.current&&!running.current)void load(true);
  },[enabled,load]);
  useEffect(()=>{
    const refresh=()=>{if(enabled||current.current)void load(true);};
    window.addEventListener('nutrition:body-saved',refresh);
    return()=>window.removeEventListener('nutrition:body-saved',refresh);
  },[enabled,load]);
  useEffect(()=>()=>{++request.current;running.current=false;},[]);

  return {records:page?.records??[],loaded:Boolean(page),hasMore:page?.hasMore??false,loading,error,load};
}
