/// <reference types="jest" />
import {Subject} from '../src/subject';

test('next keeps the observer receiver and isolates an exception from later observers', () => {
  const errors: unknown[] = [], values: string[] = [];
  const subject = new Subject<number>({onObserverError: error => errors.push(error)});
  const failure = new Error('consumer failed');
  subject.subscribe({label: 'first', next(value: number) {
    values.push(`${this.label}:${value}`);
    throw failure;
  }} as {label: string, next(value: number): void});
  subject.subscribe(value => values.push(`second:${value}`));
  subject.next(1);
  expect(values).toEqual(['first:1', 'second:1']);
  expect(errors).toEqual([failure]);
});

test('next preserves live Set iteration when observers change subscriptions', () => {
  const subject = new Subject<number>(), values: string[] = [];
  let added = false;
  subject.subscribe(value => {
    values.push(`first:${value}`);
    if (!added) {
      added = true;
      second.unsubscribe();
      subject.subscribe(value => values.push(`third:${value}`));
    }
  });
  const second = subject.subscribe(value => values.push(`second:${value}`));
  subject.next(1);
  subject.next(2);
  expect(values).toEqual(['first:1', 'third:1', 'first:2', 'third:2']);
});

test('completion during next stops delivery to cleared observers', () => {
  const subject = new Subject<number>(), values: number[] = [], complete = jest.fn();
  subject.subscribe(() => subject.complete());
  subject.subscribe({next: value => values.push(value), complete});
  subject.next(1);
  subject.next(2);
  expect(values).toEqual([]);
  expect(complete).toHaveBeenCalledTimes(1);
});
