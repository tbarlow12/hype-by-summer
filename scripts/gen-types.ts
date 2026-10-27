/**
 * Generates src/lib/supabase/database.types.ts from a live Postgres schema in
 * the same shape as `supabase gen types typescript`, without needing Docker.
 *
 *   DATABASE_URL=postgres://... npx tsx scripts/gen-types.ts
 *
 * With a hosted project you can instead run:
 *   npx supabase gen types typescript --project-id <id> > src/lib/supabase/database.types.ts
 */
import { writeFileSync } from "node:fs";
import { Client } from "pg";


const SCHEMA = "public";
const OUT = "src/lib/supabase/database.types.ts";

const scalar: Record<string, string> = {
  uuid: "string", text: "string", citext: "string", varchar: "string", bpchar: "string",
  inet: "string", date: "string", time: "string", timetz: "string", timestamp: "string",
  timestamptz: "string", interval: "string", tstzrange: "string", bytea: "string",
  int2: "number", int4: "number", int8: "number", float4: "number", float8: "number",
  numeric: "number", bool: "boolean", json: "Json", jsonb: "Json", void: "undefined",
};

async function main() {
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();

  const enums = (
    await db.query<{ name: string; values: string[] }>(`
      select t.typname as name, array_agg(e.enumlabel::text order by e.enumsortorder) as values
        from pg_type t join pg_enum e on e.enumtypid = t.oid
        join pg_namespace n on n.oid = t.typnamespace
       where n.nspname = $1 group by t.typname order by t.typname`, [SCHEMA])
  ).rows;
  const enumNames = new Set(enums.map((e) => e.name));

  const tsType = (udt: string): string => {
    const isArray = udt.startsWith("_");
    const base = isArray ? udt.slice(1) : udt;
    const t = enumNames.has(base)
      ? `Database["public"]["Enums"]["${base}"]`
      : (scalar[base] ?? "unknown");
    return isArray ? `${t}[]` : t;
  };

  const columns = (
    await db.query<{
      table: string; column: string; udt: string; nullable: boolean; has_default: boolean;
    }>(`
      select c.table_name as table, c.column_name as column, c.udt_name as udt,
             c.is_nullable = 'YES' as nullable,
             (c.column_default is not null or c.is_identity = 'YES' or c.is_generated = 'ALWAYS') as has_default
        from information_schema.columns c
        join information_schema.tables t on t.table_name = c.table_name and t.table_schema = c.table_schema
       where c.table_schema = $1 and t.table_type = 'BASE TABLE'
       order by c.table_name, c.column_name`, [SCHEMA])
  ).rows;

  const fks = (
    await db.query<{
      table: string; name: string; columns: string[]; ref_table: string; ref_columns: string[]; one_to_one: boolean;
    }>(`
      select cl.relname as table, con.conname as name,
             array(select a.attname::text from unnest(con.conkey) k join pg_attribute a on a.attrelid = con.conrelid and a.attnum = k) as columns,
             rcl.relname as ref_table,
             array(select a.attname::text from unnest(con.confkey) k join pg_attribute a on a.attrelid = con.confrelid and a.attnum = k) as ref_columns,
             exists (select 1 from pg_index i where i.indrelid = con.conrelid and i.indisunique
                       and (i.indkey::int2[])::int2[] @> con.conkey and cardinality(i.indkey::int2[]) = cardinality(con.conkey)) as one_to_one
        from pg_constraint con
        join pg_class cl on cl.oid = con.conrelid
        join pg_namespace n on n.oid = cl.relnamespace
        join pg_class rcl on rcl.oid = con.confrelid
       where con.contype = 'f' and n.nspname = $1
       order by cl.relname, con.conname`, [SCHEMA])
  ).rows;

  const functions = (
    await db.query<{
      name: string; arg_names: string[] | null; arg_udts: string[]; n_defaults: number;
      arg_modes: string[] | null; all_udts: string[] | null;
      ret: string; ret_set: boolean; ret_is_table: boolean;
    }>(`
      select p.proname as name, p.proargnames::text[] as arg_names,
                          array(select t.typname::text from unnest(p.proargtypes) with ordinality as a(oid, ord) join pg_type t on t.oid = a.oid order by a.ord) as arg_udts,
             p.pronargdefaults as n_defaults,
             p.proargmodes::text[] as arg_modes,
             case when p.proallargtypes is null then null else
               array(select t.typname::text from unnest(p.proallargtypes) with ordinality as a(oid, ord) join pg_type t on t.oid = a.oid order by a.ord)
             end as all_udts,
             rt.typname as ret, p.proretset as ret_set, rt.typtype = 'c' as ret_is_table
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
        join pg_type rt on rt.oid = p.prorettype
       where n.nspname = $1 and p.prokind = 'f' and rt.typname <> 'trigger'
         and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
       order by p.proname`, [SCHEMA])
  ).rows;

  await db.end();

  const tables = new Map<string, typeof columns>();
  for (const c of columns) {
    if (!tables.has(c.table)) tables.set(c.table, []);
    tables.get(c.table)!.push(c);
  }

  const ind = (n: number) => "  ".repeat(n);
  const out: string[] = [];
  out.push("// Generated by scripts/gen-types.ts. Do not edit by hand.");
  out.push("export type Json =\n  | string\n  | number\n  | boolean\n  | null\n  | { [key: string]: Json | undefined }\n  | Json[]\n");
  out.push("export type Database = {");
  out.push(`${ind(1)}__InternalSupabase: { PostgrestVersion: "12" };`);
  out.push(`${ind(1)}public: {`);
  out.push(`${ind(2)}Tables: {`);
  for (const [table, cols] of tables) {
    out.push(`${ind(3)}${table}: {`);
    out.push(`${ind(4)}Row: {`);
    for (const c of cols) out.push(`${ind(5)}${c.column}: ${tsType(c.udt)}${c.nullable ? " | null" : ""};`);
    out.push(`${ind(4)}};`);
    out.push(`${ind(4)}Insert: {`);
    for (const c of cols) {
      const opt = c.nullable || c.has_default ? "?" : "";
      out.push(`${ind(5)}${c.column}${opt}: ${tsType(c.udt)}${c.nullable ? " | null" : ""};`);
    }
    out.push(`${ind(4)}};`);
    out.push(`${ind(4)}Update: {`);
    for (const c of cols) out.push(`${ind(5)}${c.column}?: ${tsType(c.udt)}${c.nullable ? " | null" : ""};`);
    out.push(`${ind(4)}};`);
    out.push(`${ind(4)}Relationships: [`);
    for (const fk of fks.filter((f) => f.table === table)) {
      out.push(`${ind(5)}{`);
      out.push(`${ind(6)}foreignKeyName: "${fk.name}";`);
      out.push(`${ind(6)}columns: [${fk.columns.map((c) => `"${c}"`).join(", ")}];`);
      out.push(`${ind(6)}isOneToOne: ${fk.one_to_one};`);
      out.push(`${ind(6)}referencedRelation: "${fk.ref_table}";`);
      out.push(`${ind(6)}referencedColumns: [${fk.ref_columns.map((c) => `"${c}"`).join(", ")}];`);
      out.push(`${ind(5)}},`);
    }
    out.push(`${ind(4)}];`);
    out.push(`${ind(3)}};`);
  }
  out.push(`${ind(2)}};`);
  out.push(`${ind(2)}Views: { [_ in never]: never };`);
  out.push(`${ind(2)}Functions: {`);
  for (const f of functions) {
    // With OUT/TABLE params, proargnames covers every arg; split inputs from outputs.
    const modes = f.arg_modes ?? f.arg_udts.map(() => "i");
    const allNames = f.arg_names ?? [];
    const names = allNames.filter((_, i) => ["i", "b", "v"].includes(modes[i]!));
    const outCols = (f.all_udts ?? [])
      .map((udt, i) => ({ udt, name: allNames[i], mode: modes[i] }))
      .filter((c) => c.mode === "o" || c.mode === "t" || c.mode === "b");
    const firstOptional = f.arg_udts.length - f.n_defaults;
    // SQL args may be null; allow it so callers needn't cast.
    const args = f.arg_udts.map((udt, i) => `${names[i]}${i >= firstOptional ? "?" : ""}: ${tsType(udt)} | null`);
    let ret = f.ret_is_table
      ? `Database["public"]["Tables"]["${f.ret}"]["Row"]`
      : f.ret === "record" && outCols.length
        ? `{ ${outCols.map((c) => `${c.name}: ${tsType(c.udt)} | null`).join("; ")} }`
        : tsType(f.ret);
    if (f.ret_set) ret = `${ret}[]`;
    out.push(`${ind(3)}${f.name}: {`);
    out.push(`${ind(4)}Args: ${args.length ? `{ ${args.join("; ")} }` : "never"};`);
    out.push(`${ind(4)}Returns: ${ret};`);
    out.push(`${ind(3)}};`);
  }
  out.push(`${ind(2)}};`);
  out.push(`${ind(2)}Enums: {`);
  for (const e of enums) out.push(`${ind(3)}${e.name}: ${e.values.map((v) => `"${v}"`).join(" | ")};`);
  out.push(`${ind(2)}};`);
  out.push(`${ind(2)}CompositeTypes: { [_ in never]: never };`);
  out.push(`${ind(1)}};`);
  out.push("};\n");
  out.push('type PublicSchema = Database["public"];');
  out.push('export type Tables<T extends keyof PublicSchema["Tables"]> = PublicSchema["Tables"][T]["Row"];');
  out.push('export type TablesInsert<T extends keyof PublicSchema["Tables"]> = PublicSchema["Tables"][T]["Insert"];');
  out.push('export type TablesUpdate<T extends keyof PublicSchema["Tables"]> = PublicSchema["Tables"][T]["Update"];');
  out.push('export type Enums<T extends keyof PublicSchema["Enums"]> = PublicSchema["Enums"][T];');
  out.push("");

  writeFileSync(OUT, out.join("\n"));
  console.log(`wrote ${OUT}: ${tables.size} tables, ${functions.length} functions, ${enums.length} enums`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
