import { get } from 'node:http';

const port=process.env.PORT||18081;
const host=process.env.APP_ORIGIN?new URL(process.env.APP_ORIGIN).host:`127.0.0.1:${port}`;
const request=get(`http://127.0.0.1:${port}/api/health`,{headers:{host},timeout:3000},response=>{
  let body='';
  response.on('data',chunk=>{body+=chunk;});
  response.on('end',()=>{try{if(response.statusCode!==200||JSON.parse(body).ok!==true)process.exitCode=1;}catch{process.exitCode=1;}});
  response.on('error',()=>{process.exitCode=1;});
});
request.on('timeout',()=>request.destroy(new Error('Health check timeout')));
request.on('error',()=>{process.exitCode=1;});
