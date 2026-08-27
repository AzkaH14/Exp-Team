import Link from "next/link";
import type { ClientQoLListItem } from "@/lib/types/client-list";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";

interface ClientsQoLTableProps {
  profiles: ClientQoLListItem[];
}

const bandVariant: Record<string, "destructive" | "warning" | "secondary" | "success"> = {
  critical: "destructive",
  "at-risk": "warning",
  stable: "secondary",
  thriving: "success",
};

export function ClientsQoLTable({ profiles }: ClientsQoLTableProps) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Client</TableHead>
          <TableHead>City</TableHead>
          <TableHead>Tickets</TableHead>
          <TableHead>QoL Score</TableHead>
          <TableHead>Band</TableHead>
          <TableHead>Flags</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {profiles.map((p) => (
          <TableRow key={p.slug}>
            <TableCell>
              <Link href={`/clients/${p.slug}`} className="font-medium hover:underline">
                {p.client}
              </Link>
            </TableCell>
            <TableCell>{p.city}</TableCell>
            <TableCell>{p.tickets}</TableCell>
            <TableCell className="font-semibold">{p.overall}</TableCell>
            <TableCell>
              <Badge variant={bandVariant[p.band] ?? "secondary"}>{p.band}</Badge>
            </TableCell>
            <TableCell className="max-w-[200px] truncate text-xs text-muted-foreground">
              {p.urgentFlags.join(", ") || "—"}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
