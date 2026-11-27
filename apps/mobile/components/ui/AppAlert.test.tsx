// @vitest-environment jsdom
//
// Founder, 2026-11-27: every warning is the app's own simple, professional
// dialog (the system Alert for "remove staff" did not match the brand).
// appAlert keeps Alert.alert's call shape, so these pin the behaviour every
// migrated call site relies on: buttons, cancel, back, notices and queueing.

import { createElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';

vi.mock('react-native-mmkv', () => ({
  createMMKV: () => {
    const store = new Map<string, string>();
    return {
      set: (key: string, value: string) => void store.set(key, value),
      getString: (key: string) => store.get(key),
      remove: (key: string) => void store.delete(key),
    };
  },
}));

const back = vi.hoisted(() => ({ handler: null as null | (() => boolean) }));
interface StubProps {
  children?: ReactNode;
  onPress?: () => void;
  accessibilityLabel?: string;
  testID?: string;
  visible?: boolean;
}
vi.mock('react-native', () => ({
  View: ({ children, testID }: StubProps) => createElement('div', { 'data-testid': testID }, children),
  Text: ({ children }: StubProps) => createElement('span', null, children),
  Modal: ({ children, visible }: StubProps) => (visible ? createElement('div', { role: 'dialog' }, children) : null),
  Pressable: ({ children, onPress, accessibilityLabel }: StubProps) =>
    createElement('button', {
      onClick: (event: { stopPropagation: () => void }) => { event.stopPropagation(); onPress?.(); },
      'aria-label': accessibilityLabel,
    }, children),
  BackHandler: {
    addEventListener: (_event: string, handler: () => boolean) => {
      back.handler = handler;
      return { remove: () => { if (back.handler === handler) back.handler = null; } };
    },
  },
}));
vi.mock('@expo/vector-icons/Feather', () => ({ default: () => null }));

const { useLocaleStore } = await import('../../state/localeStore');
const { AppAlertHost, appAlert, resetAppAlertsForTests, toneOf } = await import('./AppAlert');

beforeEach(() => {
  useLocaleStore.setState({ locale: 'en' });
  back.handler = null;
  act(() => resetAppAlertsForTests());
});
afterEach(() => cleanup());

describe('appAlert', () => {
  it('renders nothing until something is asked', () => {
    render(createElement(AppAlertHost));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('shows a destructive confirm in red and runs the action once', () => {
    const remove = vi.fn();
    const cancel = vi.fn();
    render(createElement(AppAlertHost));
    act(() => appAlert('Remove this staff member?', 'John will be removed.', [
      { text: 'Cancel', style: 'cancel', onPress: cancel },
      { text: 'Remove Staff', style: 'destructive', onPress: remove },
    ]));
    expect(screen.getByText('Remove this staff member?')).toBeTruthy();
    expect(screen.getByText('John will be removed.')).toBeTruthy();
    expect(screen.getByTestId('app-alert-tone-danger')).toBeTruthy();

    fireEvent.click(screen.getByLabelText('Remove Staff'));
    expect(remove).toHaveBeenCalledTimes(1);
    expect(cancel).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('Cancel, the back button and a tap outside all cancel, and never run the action', () => {
    const remove = vi.fn();
    const cancel = vi.fn();
    const ask = () => appAlert('Archive?', undefined, [
      { text: 'Cancel', style: 'cancel', onPress: cancel },
      { text: 'Archive', style: 'destructive', onPress: remove },
    ]);
    render(createElement(AppAlertHost));

    act(ask);
    fireEvent.click(screen.getByLabelText('Cancel'));
    act(ask);
    act(() => { expect(back.handler?.()).toBe(true); });
    act(ask);
    fireEvent.click(screen.getByLabelText('Close'));

    expect(cancel).toHaveBeenCalledTimes(3);
    expect(remove).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('a notice with no buttons gets one OK and an amber icon', () => {
    render(createElement(AppAlertHost));
    act(() => appAlert('Could not hold the sale', 'Try again'));
    expect(screen.getByTestId('app-alert-tone-warning')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('OK'));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('shows two alerts one after the other, never on top of each other', () => {
    render(createElement(AppAlertHost));
    act(() => {
      appAlert('First');
      appAlert('Second');
    });
    expect(screen.getByText('First')).toBeTruthy();
    expect(screen.queryByText('Second')).toBeNull();
    fireEvent.click(screen.getByLabelText('OK'));
    expect(screen.getByText('Second')).toBeTruthy();
  });

  it('an action may raise the next alert: this one closes first', () => {
    render(createElement(AppAlertHost));
    act(() => appAlert('Delete?', undefined, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => appAlert('Could not delete') },
    ]));
    act(() => { fireEvent.click(screen.getByLabelText('Delete')); });
    expect(screen.queryByText('Delete?')).toBeNull();
    expect(screen.getByText('Could not delete')).toBeTruthy();
  });

  it('shows Bangla labels when the app is in Bangla', () => {
    useLocaleStore.setState({ locale: 'bn' });
    render(createElement(AppAlertHost));
    act(() => appAlert('বিক্রয় হোল্ড করা যায়নি'));
    expect(screen.getByLabelText('ঠিক আছে')).toBeTruthy();
  });
});

describe('no screen falls back to the system Alert', () => {
  it('every app/ and components/ dialog goes through appAlert', async () => {
    const { readdirSync, readFileSync, statSync } = await import('node:fs');
    const { join } = await import('node:path');
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path);
        else if (/\.tsx?$/.test(name) && !/\.test\./.test(name) && /Alert\.alert\(/.test(readFileSync(path, 'utf8'))) {
          offenders.push(path);
        }
      }
    };
    walk('apps/mobile/app');
    walk('apps/mobile/components');
    expect(offenders).toEqual([]);
  });
});

describe('toneOf', () => {
  it('is red for a destructive choice, amber for a notice, green otherwise', () => {
    expect(toneOf([{ text: 'Cancel', style: 'cancel' }, { text: 'Delete', style: 'destructive' }])).toBe('danger');
    expect(toneOf([])).toBe('warning');
    expect(toneOf([{ text: 'OK' }])).toBe('warning');
    expect(toneOf([{ text: 'Cancel', style: 'cancel' }, { text: 'Confirm' }])).toBe('default');
  });
});
