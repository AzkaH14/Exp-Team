import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

interface PagePlaceholderProps {
  title: string;
  description: string;
  children?: React.ReactNode;
}

export function PagePlaceholder({ title, description, children }: PagePlaceholderProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      {children && <CardContent>{children}</CardContent>}
    </Card>
  );
}
