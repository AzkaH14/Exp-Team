/** Proves accumulate+merge+finalize == buildAnalyticsFromTickets over the same rows. */
import {readFileSync} from "fs";
import {join,dirname} from "path";
import {fileURLToPath} from "url";
const root=join(dirname(fileURLToPath(import.meta.url)),"..");
// Uses the frozen historical index as a realistic dataset — the legacy
// src/data/tickets.json this originally read was deleted (stale HubSpot dump).
const tickets=JSON.parse(readFileSync(join(root,"src/data/historical-tickets-index.json"),"utf8"));
const {buildAnalyticsFromTickets}=await import("../src/lib/analytics-build.ts");
const {accumulate,mergeAggregates,finalizeAggregate}=await import("../src/lib/analytics-aggregate.ts");

const whole=buildAnalyticsFromTickets(tickets);

// split arbitrarily, aggregate each half, merge, finalize
const cut=Math.floor(tickets.length*0.6);
const merged=mergeAggregates(accumulate(tickets.slice(0,cut)),accumulate(tickets.slice(cut)));
const split=finalizeAggregate(merged,{
  source:"HubSpot CRM API (live sync)",insightPrefix:"Live sync: ",periodFallback:"—"});

let fail=0;
const eq=(label,a,b)=>{const ok=JSON.stringify(a)===JSON.stringify(b);
  if(!ok){fail++;console.log("  FAIL",label);console.log("    whole:",JSON.stringify(a).slice(0,220));
    console.log("    split:",JSON.stringify(b).slice(0,220));} else console.log("  PASS",label);};

console.log(`rows: ${tickets.length}  (split ${cut} / ${tickets.length-cut})`);
eq("kpis",whole.kpis,split.kpis);
eq("monthly",whole.monthly,split.monthly);
eq("cities",whole.cities,split.cities);
eq("categories",whole.categories,split.categories);
eq("clients",whole.clients,split.clients);
eq("topClients",whole.topClients,split.topClients);
eq("topSubServices",whole.topSubServices,split.topSubServices);
eq("pareto",whole.pareto,split.pareto);
eq("cityMonth",whole.cityMonth,split.cityMonth);
eq("forecast",whole.forecast,split.forecast);
eq("monteCarlo (determinism)",whole.monteCarlo,split.monteCarlo);
console.log(fail?`\n${fail} MISMATCH(ES)`:"\nALL MATCH — merge is behaviour-preserving");
process.exit(fail?1:0);
