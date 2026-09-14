import {analyze,tradeStudy} from './analysis.js';
self.addEventListener('message',async ({data})=>{
  const {requestId,scenario,catalog,type}=data;
  try {
    if(!['analyze','trade'].includes(type)) throw Error('지원하지 않는 분석 작업');
    const progress=p=>self.postMessage({type:'progress',requestId,progress:p});
    const result=await (type==='trade'?tradeStudy:analyze)(scenario,catalog,progress);
    self.postMessage({type:'result',requestId,result});
  } catch(error) {self.postMessage({type:'error',requestId,message:error.message});}
});
