import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { NodeResizer, type Node, type NodeProps } from '@xyflow/react'

/** Flow-aligned with `MapView` `MANUAL_GROUP_MIN_*` (avoid importing MapView → cycle). */
const MIN_W = 220
const MIN_H = 140

export type ManualGroupResizeBounds = { x: number; y: number; width: number; height: number }

/**
 * Visual container for Phase 2A manual grouping only (persisted).
 * Phase 2B temporary grouping uses `AutoGroupNode` — do not merge behaviors here.
 */
export type ManualGroupFlowNode = Node<
  {
    name: string
    width: number
    height: number
    contentsLocked?: boolean
    onCommitRename: (name: string) => void
    onDelete: () => void
    onResizeSessionStart?: () => void
    onResizeLive?: (b: ManualGroupResizeBounds) => void
    onResizeSessionEnd?: (b: ManualGroupResizeBounds) => void
  },
  'manualGroup'
>

function ManualGroupNodeInner({ data, selected }: NodeProps<ManualGroupFlowNode>): JSX.Element {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(data.name)
  const inputRef = useRef<HTMLInputElement>(null)
  /** Enter/Escape trigger programmatic blur; skip the blur handler once so we don’t double-save/cancel. */
  const ignoreNextBlurRef = useRef(false)

  useEffect(() => {
    if (!editing) setDraft(data.name)
  }, [data.name, editing])

  useLayoutEffect(() => {
    if (!editing) return
    const el = inputRef.current
    if (!el) return
    el.focus()
    try {
      el.select()
    } catch {
      /* ignore */
    }
  }, [editing])

  const cancelEdit = useCallback(() => {
    setDraft(data.name)
    setEditing(false)
  }, [data.name])

  const applyIfChanged = useCallback(() => {
    const next = draft.trim()
    if (!next) {
      cancelEdit()
      return
    }
    if (next === data.name.trim()) {
      setEditing(false)
      return
    }
    setEditing(false)
    data.onCommitRename(next)
  }, [cancelEdit, data, draft])

  const onTitleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      /* Stop graph/canvas from seeing typing while the input is focused. */
      e.stopPropagation()
      if (e.key === 'Enter') {
        e.preventDefault()
        ignoreNextBlurRef.current = true
        applyIfChanged()
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        ignoreNextBlurRef.current = true
        cancelEdit()
      }
    },
    [applyIfChanged, cancelEdit]
  )

  const resizable = Boolean(
    data.onResizeLive && data.onResizeSessionEnd && !data.contentsLocked
  )

  return (
    <div
      className={`map-manual-group${selected ? ' map-manual-group--selected' : ''}`}
      style={{ width: data.width, height: data.height }}
    >
      {resizable ? (
        <NodeResizer
          isVisible={selected}
          minWidth={MIN_W}
          minHeight={MIN_H}
          handleClassName="map-manual-group__resize-handle nodrag nopan"
          lineClassName="map-manual-group__resize-line nodrag nopan"
          onResizeStart={() => data.onResizeSessionStart?.()}
          onResize={(_, p) => data.onResizeLive?.(p)}
          onResizeEnd={(_, p) => data.onResizeSessionEnd?.(p)}
        />
      ) : null}
      <div className="map-manual-group__chrome nodrag nopan">
        {data.contentsLocked ? (
          <div className="map-manual-group__lock" title="Group contents locked" aria-hidden>
            🔒
          </div>
        ) : null}
        <div className="map-manual-group__title-wrap">
          {editing ? (
            <input
              ref={inputRef}
              type="text"
              className="map-manual-group__title-input nodrag nopan nokey"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={onTitleKeyDown}
              onBlur={() => {
                if (ignoreNextBlurRef.current) {
                  ignoreNextBlurRef.current = false
                  return
                }
                applyIfChanged()
              }}
              onClick={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
              onPointerDown={(e) => e.stopPropagation()}
              aria-label="Group name"
            />
          ) : (
            <button
              type="button"
              className="map-manual-group__title map-manual-group__title--editable"
              title="Click to rename"
              onClick={(e) => {
                e.stopPropagation()
                setEditing(true)
                setDraft(data.name)
              }}
              onMouseDown={(e) => e.stopPropagation()}
              onPointerDown={(e) => e.stopPropagation()}
            >
              {data.name}
            </button>
          )}
        </div>
        <div className="map-manual-group__actions">
          <button
            type="button"
            className="danger map-manual-group__btn"
            onClick={(e) => {
              e.stopPropagation()
              data.onDelete()
            }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            Delete
          </button>
        </div>
      </div>
      {/*
        Drag surface below the title bar: moving the group uses this area (locked: body includes space over devices;
        devices in locked groups are non-draggable and clicks on them select the group from MapView).
      */}
      <div className="map-manual-group__drag-surface" title="Drag to move group" aria-hidden />
    </div>
  )
}

export const ManualGroupNode = memo(ManualGroupNodeInner)
