import { describe, expect, it } from "vitest";
import { generatedBlocks, renderRollbackDocs } from "../../../scripts/render-rollback-docs.mjs";

// Supplemental portability coverage; historical E4 acceptance tests stay sealed.
describe("rollback renderer line endings", () => {
  it.each(["\n","\r\n"])("preserves %j while detecting a real generated-block mutation", eol => {
    const blocks = generatedBlocks();
    const sources = Object.fromEntries(Object.entries(blocks).map(([key,body]) => [
      key, ["prefix","<!-- rollback-classification:start -->",body.trim(),"<!-- rollback-classification:end -->","suffix"].join("\n").replace(/\n/g,eol),
    ])) as {rollback:string;backend:string;mobile:string};
    expect(renderRollbackDocs(sources)).toEqual(sources);
    for (const key of ["rollback","backend","mobile"] as const) {
      const body=blocks[key].replace(/\n/g,eol);
      const tick=String.fromCharCode(96);
      const mutated=body.replace(/C: (\d+)/,(_match:string,n:string)=>"C: "+(Number(n)+1)).replace(tick+"0001"+tick,tick+"9999"+tick);
      expect(mutated).not.toBe(body);
      const changed={...sources,[key]:sources[key].replace(body,mutated)};
      expect(changed[key]).toContain(mutated);
      expect(renderRollbackDocs(changed)[key]).toBe(sources[key]);
    }
  });
});
