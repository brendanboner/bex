'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Shield, ShieldOff } from 'lucide-react';
import { adminApi } from '@/lib/api';
import { formatDate } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { toast } from '@/hooks/use-toast';

type User = {
  id: string;
  externalId: string;
  displayName: string;
  email?: string;
  isSystemUser: boolean;
  createdAt: string;
};

export default function UsersPage() {
  const qc = useQueryClient();

  const { data: users = [], isLoading } = useQuery({
    queryKey: ['users'],
    queryFn: () => adminApi.get<User[]>('/admin/users'),
  });

  const toggleSystemMutation = useMutation({
    mutationFn: ({ id, isSystemUser }: { id: string; isSystemUser: boolean }) =>
      adminApi.patch(`/admin/users/${id}`, { isSystemUser }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['users'] });
      toast({ title: 'User updated' });
    },
    onError: (e) => toast({ title: 'Error', description: (e as Error).message, variant: 'destructive' }),
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Users</h1>
        <p className="text-muted-foreground">Manage user access levels. System users can publish skills and manage endpoints.</p>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>External ID</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Joined</TableHead>
                <TableHead className="w-16" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">Loading…</TableCell></TableRow>}
              {users.map((u) => (
                <TableRow key={u.id}>
                  <TableCell className="font-medium">{u.displayName}</TableCell>
                  <TableCell className="text-sm font-mono text-muted-foreground">{u.externalId}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{u.email ?? '—'}</TableCell>
                  <TableCell>
                    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold ${u.isSystemUser ? 'bg-slate-700 text-slate-100' : 'bg-gray-100 text-gray-700'}`}>
                      {u.isSystemUser ? <Shield className="h-3 w-3" /> : null}
                      {u.isSystemUser ? 'System' : 'User'}
                    </span>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">{formatDate(u.createdAt)}</TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="icon"
                      title={u.isSystemUser ? 'Revoke system access' : 'Grant system access'}
                      onClick={() => toggleSystemMutation.mutate({ id: u.id, isSystemUser: !u.isSystemUser })}
                      disabled={toggleSystemMutation.isPending}
                    >
                      {u.isSystemUser
                        ? <ShieldOff className="h-4 w-4 text-destructive" />
                        : <Shield className="h-4 w-4 text-muted-foreground" />
                      }
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {!isLoading && users.length === 0 && (
                <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">No users found</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
