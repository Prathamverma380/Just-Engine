type SqliteDatabase = {
    exec: (sql: string) => void;
    prepare: (sql: string) => {
        run: (...params: any[]) => any;
        get: (...params: any[]) => any;
        all: (...params: any[]) => any[];
    };
};
export declare function getDataRootPath(): string | null;
export declare function ensureDataDirectory(directoryName?: string): string;
export declare function getDatabase(): SqliteDatabase | null;
export declare function safeJsonParse<T>(value: string, fallback: T): T;
export declare function getPersistencePath(): string | null;
export {};
