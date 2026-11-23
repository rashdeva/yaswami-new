import { Link } from 'expo-router';
import { Pressable, Text } from 'react-native';
import type { JobItem, Wire } from '@yaswami/core';
import { colors } from '@/theme';

export function JobRow({ job }: { job: Wire<JobItem> }) {
  return (
    <Link href={{ pathname: '/jobs/[id]', params: { id: job.id } }} asChild>
      <Pressable style={{ padding: 14, gap: 3, borderRadius: 16, borderCurve: 'continuous', backgroundColor: colors.card }}>
        <Text style={{ color: colors.label, fontSize: 17, fontWeight: '600' }}>{job.title}</Text>
        {!!job.employer && <Text style={{ color: colors.secondaryLabel, fontSize: 15 }}>{job.employer}</Text>}
        {!!job.pay && <Text style={{ color: colors.good, fontSize: 15, fontWeight: '500' }}>{job.pay}</Text>}
      </Pressable>
    </Link>
  );
}
