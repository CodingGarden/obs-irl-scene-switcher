import { reactive } from 'vue';

export default function reactiveFromLocalStorage<T extends object>(key: string, initialValue: T) {
  const localStorageJSON = localStorage.getItem(key) || '{}';
  return reactive<T>({
    ...initialValue,
    ...JSON.parse(localStorageJSON),
  });
}
