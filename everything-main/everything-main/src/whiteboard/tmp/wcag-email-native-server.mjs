import http from "node:http";
import {environment,owner} from "../tests/collaboration-helpers.js";
import {adminCall} from "../worker/admin.js";
const contexts={};
for(const lang of ["en","fr","en-expiry","fr-expiry"]){
 const env=environment(),service=env.service,org=service.org,messages=[];
 org.puter.email={async sendTransactional(message){messages.push(message);return {failed:[]};}};
 await adminCall(org,service,owner,{op:"org.setup",name:"Local native verification audit "+lang,domains:["example.org"]});
 await org.saveUser({...owner,email:"fixture@example.org",emailVerified:false,status:"active",created:org.now(),teams:[]});
 contexts[lang]={env,service,org,messages};
}
http.createServer(async(req,res)=>{
 res.setHeader("Access-Control-Allow-Origin","http://127.0.0.1:5181");
 res.setHeader("Access-Control-Allow-Headers","Content-Type");
 if(req.method==="OPTIONS"){res.writeHead(204);res.end();return;}
 res.setHeader("Content-Type","application/json");
 try{
  const url=new URL(req.url,"http://127.0.0.1:5183");
  const lang=url.searchParams.get("lang")==="fr"?"fr":"en";
  const {env,service,org,messages}=contexts[lang+(url.searchParams.get("scenario")==="expiry"?"-expiry":"")];
  if(url.pathname==="/advance"&&url.searchParams.get("scenario")==="expiry"){
   env.now+=16*60_000;
   res.end(JSON.stringify({advancedMinutes:16}));return;
  }
  if(url.pathname==="/captured"){
   res.end(JSON.stringify({code:messages.length?/code is (\d{6})/.exec(messages.at(-1).text)[1]:null,count:messages.length}));
   return;
  }
  let input={op:"org.info"};
  if(req.method==="POST"){
   let body="";for await(const chunk of req)body+=chunk;
   input=JSON.parse(body);
  }
  const result=await adminCall(org,service,owner,input);
  res.end(JSON.stringify(result));
 }catch(error){res.writeHead(400);res.end(JSON.stringify({error:error.message}));}
}).listen(5183,"127.0.0.1",()=>console.log("Isolated actual organization worker ready on http://127.0.0.1:5183; messages captured locally."));
