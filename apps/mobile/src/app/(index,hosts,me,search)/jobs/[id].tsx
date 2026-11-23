import { Stack, useLocalSearchParams } from 'expo-router';
import { Linking, ScrollView, Text, View } from 'react-native';
import { Button } from '@/components/button';
import { Row, Section } from '@/components/section';
import { State } from '@/components/state';
import { useJob } from '@/queries';
import { colors } from '@/theme';

export default function Job() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: job, error, refetch } = useJob(id);
  if (!job) return <State loading error={error} onRetry={refetch} />;
  return (
    <>
      <Stack.Screen options={{ title: job.title }} />
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ padding: 16, gap: 20, paddingBottom: 48 }}>
        <View style={{ gap: 6 }}>
          <Text selectable style={{ color: colors.label, fontSize: 28, fontWeight: '700' }}>{job.title}</Text>
          {!!job.employer && <Text selectable style={{ color: colors.secondaryLabel, fontSize: 17 }}>{job.employer}</Text>}
          {!!job.pay && <Text selectable style={{ color: colors.good, fontSize: 17, fontWeight: '600' }}>{job.pay}</Text>}
        </View>
        <View style={{ flexDirection: 'row' }}><Button title="Написать работодателю" onPress={() => void Linking.openURL(job.contact_url)} /></View>
        {!!job.description && <Section><Row>{job.description}</Row></Section>}
      </ScrollView>
    </>
  );
}
