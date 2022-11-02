import { reactive, watch, type UnwrapNestedRefs } from 'vue';

interface ReactiveFromLocalStorageOptions<T> {
  key: string;
  initialValue: T;
  watchValue?: boolean;
  onChange?: (value: UnwrapNestedRefs<T>) => unknown;
}

export default function reactiveFromLocalStorage<T extends object>({
  key,
  initialValue,
  watchValue = false,
  onChange,
}: ReactiveFromLocalStorageOptions<T>) {
  const localStorageJSON = localStorage.getItem(key) || '{}';
  const value = reactive<T>({
    ...initialValue,
    ...JSON.parse(localStorageJSON),
  });
  if (watchValue) {
    watch(value, () => {
      localStorage.setItem(
        key,
        JSON.stringify(value),
      );
      if (onChange) {
        onChange(value);
      }
    });
  }
  return value;
}
