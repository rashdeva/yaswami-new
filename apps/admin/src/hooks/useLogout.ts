import { useMutation } from '@tanstack/react-query';
import { api } from '../api.ts';

/** Выйти: сервер снимает cookie сайта, страница открывается заново — уже с кнопкой входа. */
export const useLogout = () => useMutation({ mutationFn: api.logout, onSuccess: () => location.reload() }).mutate;
