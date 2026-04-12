/**
 * Layout is never stored on `Equipment`. Same equipment may appear in multiple layouts
 * (multi-map / multi-window).
 */

export interface EquipmentLayout {
  id: string
  equipmentId: string
  layoutViewId: string
  x: number
  y: number
  zIndex?: number
  locked: boolean
  hidden: boolean
  groupId?: string
}

export interface LayoutGroup {
  id: string
  label?: string
}
