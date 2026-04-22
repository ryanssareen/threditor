// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { UndoRedoControls } from '../app/editor/_components/UndoRedoControls';

// @ts-expect-error — flag for React 19 act() in tests
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe('UndoRedoControls', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    document.body.removeChild(container);
  });

  const query = (testid: string): HTMLButtonElement =>
    container.querySelector(`[data-testid="${testid}"]`) as HTMLButtonElement;

  it('disables both buttons when canUndo=false and canRedo=false', () => {
    act(() => {
      root.render(
        <UndoRedoControls
          canUndo={false}
          canRedo={false}
          onUndo={() => {}}
          onRedo={() => {}}
        />,
      );
    });
    expect(query('undo-button').disabled).toBe(true);
    expect(query('redo-button').disabled).toBe(true);
  });

  it('enables buttons according to props', () => {
    act(() => {
      root.render(
        <UndoRedoControls
          canUndo={true}
          canRedo={false}
          onUndo={() => {}}
          onRedo={() => {}}
        />,
      );
    });
    expect(query('undo-button').disabled).toBe(false);
    expect(query('redo-button').disabled).toBe(true);
  });

  it('invokes onUndo / onRedo on click', () => {
    const onUndo = vi.fn();
    const onRedo = vi.fn();
    act(() => {
      root.render(
        <UndoRedoControls
          canUndo={true}
          canRedo={true}
          onUndo={onUndo}
          onRedo={onRedo}
        />,
      );
    });
    act(() => {
      query('undo-button').click();
    });
    act(() => {
      query('redo-button').click();
    });
    expect(onUndo).toHaveBeenCalledTimes(1);
    expect(onRedo).toHaveBeenCalledTimes(1);
  });

  it('click does not fire when disabled', () => {
    const onUndo = vi.fn();
    act(() => {
      root.render(
        <UndoRedoControls
          canUndo={false}
          canRedo={false}
          onUndo={onUndo}
          onRedo={() => {}}
        />,
      );
    });
    act(() => {
      query('undo-button').click();
    });
    expect(onUndo).not.toHaveBeenCalled();
  });
});
