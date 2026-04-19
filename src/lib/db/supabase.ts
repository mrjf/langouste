import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@supabase/supabase-js";
import { config } from "../config.ts";
import type {
  Database,
  DatabaseSet,
  Filter,
  Scalar,
  SelectOptions,
} from "./types.ts";

/**
 * Supabase-backed Database. Thin wrapper over `@supabase/supabase-js` so
 * existing query shapes in src/services/database/*.ts keep working.
 */
class SupabaseDatabase implements Database {
  constructor(private client: SupabaseClient) {}

  async select<T>(table: string, options: SelectOptions = {}): Promise<T[]> {
    const builder = this.build(table, options);
    const { data, error } = await builder;
    if (error) throw error;
    return (data ?? []) as T[];
  }

  async selectOne<T>(table: string, options: SelectOptions = {}): Promise<T | null> {
    const builder = this.build(table, { ...options, limit: 1 }).maybeSingle();
    const { data, error } = await builder;
    if (error) {
      if ((error as { code?: string }).code === "PGRST116") return null;
      throw error;
    }
    return (data ?? null) as T | null;
  }

  async insert<T>(table: string, row: Record<string, unknown>): Promise<T> {
    const { data, error } = await this.client
      .from(table)
      .insert(row)
      .select()
      .single();
    if (error) throw error;
    return data as T;
  }

  async upsert<T>(
    table: string,
    row: Record<string, unknown>,
    conflictColumns: string[],
  ): Promise<T> {
    const { data, error } = await this.client
      .from(table)
      .upsert(row, { onConflict: conflictColumns.join(",") })
      .select()
      .single();
    if (error) throw error;
    return data as T;
  }

  async update(
    table: string,
    patch: Record<string, unknown>,
    filters: Filter[],
  ): Promise<void> {
    const builder = this.applyFilters(this.client.from(table).update(patch), filters);
    const { error } = await builder;
    if (error) throw error;
  }

  async updateOne<T>(
    table: string,
    patch: Record<string, unknown>,
    filters: Filter[],
  ): Promise<T> {
    const builder = this.applyFilters(this.client.from(table).update(patch), filters)
      .select()
      .single();
    const { data, error } = await builder;
    if (error) throw error;
    return data as T;
  }

  async delete(table: string, filters: Filter[]): Promise<void> {
    const builder = this.applyFilters(this.client.from(table).delete(), filters);
    const { error } = await builder;
    if (error) throw error;
  }

  async rpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
    const { data, error } = await this.client.rpc(name, args);
    if (error) throw error;
    return data as T;
  }

  async raw<T>(sql: string, params: Scalar[] = []): Promise<T[]> {
    // Supabase exposes raw SQL only via an RPC named `execute_sql`; we opted
    // not to define that so misuse is loud. If a caller hits this we throw and
    // point them at the right direction.
    throw new Error(
      `raw() is not supported on the Supabase backend (sql=${sql.slice(0, 60)}). ` +
        `Define a Postgres function and call it via rpc() instead.`,
    );
    // These args participate only in the signature:
    void params;
  }

  private build(table: string, options: SelectOptions) {
    let q = this.client.from(table).select(options.columns ?? "*");
    if (options.filters) q = this.applyFilters(q, options.filters) as typeof q;
    if (options.order) {
      for (const o of options.order) {
        q = q.order(o.column, { ascending: o.ascending ?? true });
      }
    }
    if (options.limit != null) q = q.limit(options.limit);
    return q;
  }

  // deno-lint-ignore no-explicit-any
  private applyFilters<Q extends { eq: any; lt: any; lte: any; in: any }>(
    q: Q,
    filters: Filter[],
  ): Q {
    let out = q;
    for (const f of filters) {
      switch (f.op) {
        case "eq":
          out = out.eq(f.column, f.value);
          break;
        case "lt":
          out = out.lt(f.column, f.value);
          break;
        case "lte":
          out = out.lte(f.column, f.value);
          break;
        case "in":
          out = out.in(f.column, f.values);
          break;
      }
    }
    return out;
  }
}

export function createSupabaseDatabaseSet(): DatabaseSet {
  const adminClient = createClient(config.supabaseUrl, config.supabaseSecretKey);
  const admin = new SupabaseDatabase(adminClient);
  return {
    admin,
    forUser(accessToken: string) {
      const userClient = createClient(
        config.supabaseUrl,
        config.supabasePublishableKey,
        { global: { headers: { Authorization: `Bearer ${accessToken}` } } },
      );
      return new SupabaseDatabase(userClient);
    },
    async close() {
      // Supabase client has no explicit close; sockets tear down on GC
    },
  };
}
