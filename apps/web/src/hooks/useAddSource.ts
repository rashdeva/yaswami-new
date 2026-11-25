import { useMutation } from '@tanstack/react-query';
import type { SourceAddInput } from '@yaswami/core';
import { track } from '../analytics.ts';
import { api } from '../api.ts';

/**
 * Предложить источник анонсов: канал Telegram или профиль Instagram. Ничего в кэше не меняет — источник ждёт решения
 * команды, а гость своих заявок не видит; когда одобрят, ему напишет бот.
 */
export function useAddSource() {
  return useMutation({
    mutationFn: (input: SourceAddInput) => api.addSource(input),
    onSuccess: (sent) => track('source_added', { channel: sent.channel }),
  });
}
