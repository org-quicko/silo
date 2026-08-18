import { ValidationError } from "@silo/shared/validation-error";
import { QueryUtils } from "../../../core/query/query-utils";

export class SqliteCompiler {
  private static readonly cmpOps: Record<string, string> = {
    gt: " > ?",
    gte: " >= ?",
    lt: " < ?",
    lte: " <= ?",
  };

  static fieldExpr(field: string): { expr: string; args: any[] } {
    switch (field) {
      case "$id":
        return { expr: "id", args: [] };
      case "$created_at":
        return { expr: "created_at", args: [] };
      case "$updated_at":
        return { expr: "updated_at", args: [] };
      case "$seq":
        return { expr: "seq", args: [] };
      case "$rev":
        return { expr: "rev", args: [] };
    }
    return { expr: "json_extract(data, ?)", args: ["$." + field] };
  }

  static buildFilter(f: any): { cond: string; args: any[] } {
    if (f.op === "and" || f.op === "or") {
      if (!f.args || f.args.length === 0) {
        throw new Error(`op "${f.op}" requires args`);
      }
      const joiner = f.op === "or" ? " OR " : " AND ";
      const parts: string[] = [];
      const args: any[] = [];

      for (const arg of f.args) {
        const res = SqliteCompiler.buildFilter(arg);
        parts.push("(" + res.cond + ")");
        args.push(...res.args);
      }
      return { cond: parts.join(joiner), args };
    }

    if (!QueryUtils.validField(f.field)) {
      throw new ValidationError(`invalid filter field "${f.field}"`);
    }

    const { expr, args: exprArgs } = SqliteCompiler.fieldExpr(f.field);

    switch (f.op) {
      case "eq":
        return { cond: `${expr} IS ?`, args: [...exprArgs, f.value] };
      case "neq":
        return { cond: `${expr} IS NOT ?`, args: [...exprArgs, f.value] };
      case "gt":
      case "gte":
      case "lt":
      case "lte":
        return { cond: `${expr}${SqliteCompiler.cmpOps[f.op]}`, args: [...exprArgs, f.value] };
      case "in": {
        if (!Array.isArray(f.value) || f.value.length === 0) {
          throw new Error(`op "in" requires a non-empty array value`);
        }
        const ph = Array(f.value.length).fill("?").join(",");
        return { cond: `${expr} IN (${ph})`, args: [...exprArgs, ...f.value] };
      }
      case "contains": {
        if (QueryUtils.isEnvelopeField(f.field)) {
          return { cond: `instr(${expr}, ?) > 0`, args: [...exprArgs, f.value] };
        }
        const path = "$." + f.field;
        const cond = `(CASE WHEN json_type(data, ?) = 'array' ` +
          `THEN EXISTS (SELECT 1 FROM json_each(data, ?) WHERE json_each.value IS ?) ` +
          `ELSE instr(COALESCE(json_extract(data, ?), ''), ?) > 0 END)`;
        return { cond, args: [path, path, f.value, path, f.value] };
      }
      default:
        throw new Error(`unknown filter op "${f.op}"`);
    }
  }

  static buildOrder(sort: any[]): { order: string; args: any[] } {
    const parts: string[] = [];
    const args: any[] = [];

    for (const k of sort) {
      if (!QueryUtils.validField(k.field)) {
        throw new ValidationError(`invalid sort field "${k.field}"`);
      }
      const { expr, args: exprArgs } = SqliteCompiler.fieldExpr(k.field);
      const suffix = k.desc ? " DESC" : "";
      parts.push(expr + suffix);
      args.push(...exprArgs);
    }

    parts.push("id ASC");
    return { order: parts.join(", "), args };
  }
}
