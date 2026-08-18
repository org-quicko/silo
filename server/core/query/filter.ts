export interface Filter {
  op: string;
  field?: string;
  value?: any;
  args?: Filter[];
}
