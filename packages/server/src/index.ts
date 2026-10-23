import process from "node:process";
import { ProcessHost } from "./app/ProcessHost.js";

await new ProcessHost(process).run((factory) => factory.createServer());
