import {createServer} from 'node:http';
import {productionHandler} from './runtime.mjs';
createServer(productionHandler()).listen(Number(process.env.PORT||8787),'127.0.0.1');
