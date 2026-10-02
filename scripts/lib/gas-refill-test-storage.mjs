import { DatabaseSync } from "node:sqlite";

export function gasRefillTestStorage() {
  const native = new DatabaseSync(":memory:");
  const DB = {
    prepare(sql) {
      const statement = native.prepare(sql);
      let args = [];
      const wrapper = {
        bind(...values) { args = values; return wrapper; },
        _run() {
          const result = statement.run(...args);
          return { success: true, meta: { changes: Number(result.changes) } };
        },
        async run() { return wrapper._run(); },
        async first() { return statement.get(...args) || null; },
        async all() { return { success: true, results: statement.all(...args) }; },
      };
      return wrapper;
    },
    async batch(statements) {
      native.exec("BEGIN IMMEDIATE");
      try {
        const results = statements.map((statement) => statement._run());
        native.exec("COMMIT");
        return results;
      } catch (error) {
        native.exec("ROLLBACK");
        throw error;
      }
    },
  };
  return { DB, native };
}
