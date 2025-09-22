export interface ManifestColumn {
  name: string;
  originalType: string;
  postgresType: string;
  nullable: boolean;
  comment?: string;
}

export interface ManifestTable {
  schema: string;
  name: string;
  fullName?: string;
  columns: ManifestColumn[];
  primaryKey?: string[];
}

export interface SchemaManifest {
  schemas: Array<{
    name: string;
    tables: ManifestTable[];
  }>;
  sourceDocument: string;
  generatedAt: string;
}
