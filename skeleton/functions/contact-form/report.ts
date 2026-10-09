export type ReportLevel = "warning" | "error" | "fatal";

export type ReportError = (error: unknown, level: ReportLevel) => void;
