import { useQuery } from '@tanstack/react-query';
import { api } from '../api.ts';
import { keys } from './keys.ts';

/** Аудитория организатора: гости его событий и клиенты его услуг. Читается только у организатора. */
export function useContacts(enabled: boolean) {
  const { data } = useQuery({ queryKey: keys.contacts, queryFn: api.contacts, enabled });
  return data?.entries ?? null;
}
