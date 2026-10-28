import { type WebComponent, WebComponentBase, customElement, html } from "../core";
import LayerItem from "./layer-item";
import { LayerEvents, type LayerEventPayload, type LayersManagerEventMap } from "./types";

/** @private */
const getLayersManagerHtml = html<{ isExpanded: boolean }>`
  <style>
    :host {
      --x-offset: 44px;
      --y-offset: 94px;

      position: fixed;
      top: 0;
      left: 0;
      z-index: 1000;
      /* Initial position */
      transform: translate3d(var(--x-offset), var(--y-offset), 0);
      will-change: transform;
      /* Prevent scroll while dragging */
      touch-action: none;
      font-family: sans-serif;
      cursor: default;
    }

    .panel {
      width: 260px;
      background-color: #2d2d2d;
      border: 1px solid #3f3f3f;
      border-radius: 6px;
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
      overflow: hidden;
      display: flex;
      flex-direction: column;
    }

    .header {
      display: flex;
      align-items: center;
      background-color: #333333;
      border-bottom: 1px solid #3f3f3f;
      padding: 8px 12px;
      user-select: none;
    }

    .drag-handle {
      background: none;
      border: none;
      color: #888;
      cursor: grab;
      padding: 4px;
      margin-right: 8px;
      border-radius: 4px;
      font-size: 14px;
      line-height: 1;
    }

    .drag-handle:focus-visible {
      outline: 2px solid #007acc;
      color: #e0e0e0;
    }

    .drag-handle:active {
      cursor: grabbing;
    }

    .drag-handle:hover {
      background-color: #555;
      color: #fff;
    }

    .title {
      color: #e0e0e0;
      font-weight: 600;
      font-size: 14px;
      flex-grow: 1;
    }

    .toggle-btn {
      background: none;
      border: none;
      color: #e0e0e0;
      cursor: pointer;
      font-size: 16px;
      padding: 4px 8px;
      border-radius: 4px;
      transition: background-color 0.2s;
    }

    .toggle-btn:hover,
    .toggle-btn:focus-visible {
      background-color: #444;
      outline: none;
    }

    .toggle-btn:focus-visible {
      outline: 2px solid #007acc;
    }

    .collapsible-content {
      height: var(--max-height, 0);
      overflow: hidden;
      transition: height 0.25s cubic-bezier(0.4, 0, 0.2, 1);
    }

    .content-inner {
      padding: 8px;
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
  </style>

  <div class="panel" role="region" aria-label="Layer Manager">
    <div class="header">
      <button
        data-id="drag-handle"
        class="drag-handle"
        aria-label="Move panel"
        title="Drag or use arrow keys"
      >
        ⋮⋮
      </button>
      <span class="title">Layers</span>
      <button
        data-id="toggle-btn"
        class="toggle-btn"
        aria-expanded="true"
        aria-controls="layer-content"
        aria-label="Toggle Layers"
      >
        ${(p) => (p.isExpanded ? "[\u2013]" : "[\u002b]")}
      </button>
    </div>

    <div class="collapsible-content" id="layer-content">
      <div class="content-inner">
        <slot></slot>
      </div>
    </div>
  </div>
`;

const LayersManagerBase = WebComponentBase<LayersManagerEventMap>({ mode: "open" });

@customElement("layers-manager")
export default class LayersManager extends LayersManagerBase implements WebComponent {
  private _isExpanded: boolean = true;
  private _isDragging: boolean = false;

  private _xOffset: number;
  private _yOffset: number;
  private _currentX: number;
  private _currentY: number;
  private _initialX: number;
  private _initialY: number;

  // private _panel: HTMLElement;
  // private _header: HTMLElement;
  private _dragHandle: HTMLElement;
  private _toggleBtn: HTMLElement;
  private _panelContent: HTMLElement;
  private _panelContentInner: HTMLElement;

  private _resizeObserver!: ResizeObserver;

  private _abortController!: AbortController;

  private _draggedItem: LayerItem | null = null;
  private _dragPlaceholder: HTMLElement | null = null;
  private _isDraggingActive = false;
  private _dragStartPosX = 0;
  private _dragStartPosY = 0;
  private _dragInitialOffsetTop = 0;
  private _dragPrevPosY = 0;
  private _dragCurrPosX = 0;
  private _dragCurrPosY = 0;
  private _isSwapAnimInProgress = false;
  private _scrollAnimFrame: number | null = null;
  private _scrollSpeed = 0;
  private _scrollThreshold = 40;
  private _swapAnimDuration = 0;

  constructor() {
    super();

    this._isExpanded = true;
    this._isDragging = false;

    // Position tracking
    this._xOffset = 44; // Default starting X
    this._yOffset = 94; // Default starting Y
    this._currentX = 0;
    this._currentY = 0;
    this._initialX = 0;
    this._initialY = 0;

    this._shadowRoot.innerHTML = getLayersManagerHtml({ isExpanded: this._isExpanded });

    // this._panel = shadowRoot.querySelector(".panel")!;
    // this._header = shadowRoot.querySelector(".header")!;
    this._dragHandle = this._shadowRoot.querySelector('[data-id="drag-handle"]')!;
    this._toggleBtn = this._shadowRoot.querySelector('[data-id="toggle-btn"]')!;
    this._panelContent = this._shadowRoot.querySelector(".collapsible-content")!;
    this._panelContentInner = this._shadowRoot.querySelector(".content-inner")!;

    // Dragging
    this._drag = this._drag.bind(this);
    this._dragEnd = this._dragEnd.bind(this);
    // Panel Toggle
    this._togglePanel = this._togglePanel.bind(this);
    // Stop propagation
    this._stopPropagation = this._stopPropagation.bind(this);
    // Abort
    this._onAbortSignalAborted = this._onAbortSignalAborted.bind(this);
  }

  public connectedCallback() {
    this._abortController = new AbortController();
    const { signal } = this._abortController;

    // Dragging
    this._initDraggingLogic(signal);
    // Panel Toggle Event
    this._toggleBtn.addEventListener("click", this._togglePanel, { signal });

    // Reorder children
    this._initLayersReorder(signal);
    // Toggle active child
    this.addEventListener(LayerEvents.Select, this._handlerLayerSelect, { signal });

    // Stop propagation
    this.addEventListener("click", this._stopPropagation, { signal });
    this.addEventListener("dblclick", this._stopPropagation, { signal });
    this.addEventListener("wheel", this._stopPropagation, { signal }); // Stops canvas zooming when scrolling layer list
    this.addEventListener("contextmenu", this._stopPropagation, { signal }); // Stops custom canvas right-click menus

    // Resize Observer
    this._resizeObserver = new ResizeObserver(() => {
      if (this._isExpanded && this._panelContent.style.height !== "auto") {
        this._panelContent.style.setProperty(
          "--max-height",
          `${this._panelContent.scrollHeight}px`
        );
        this._panelContent.style.height = "var(--max-height)";
      }
    });
    this._resizeObserver.observe(this._panelContentInner);
  }

  public disconnectedCallback() {
    // Resize Observer
    this._resizeObserver.disconnect();

    this._abortController.abort();
    const { signal } = this._abortController;
    signal?.removeEventListener("abort", this._onAbortSignalAborted);
  }

  private _initDraggingLogic(signal: AbortSignal) {
    signal.addEventListener("abort", this._onAbortSignalAborted);

    // Dragging Event
    this._dragHandle.addEventListener(
      "pointerdown",
      (ev: PointerEvent) => {
        this._isDragging = true;

        this._dragHandle.setPointerCapture(ev.pointerId);

        this._initialX = ev.clientX - this._xOffset;
        this._initialY = ev.clientY - this._yOffset;

        this._dragHandle.addEventListener("pointermove", this._drag);
        this._dragHandle.addEventListener("pointerup", this._dragEnd);
        this._dragHandle.addEventListener("pointercancel", this._dragEnd);
      },
      { signal }
    );

    // Keyboard Dragging Accessibility
    this._dragHandle.addEventListener(
      "keydown",
      (ev: KeyboardEvent) => {
        const step = ev.shiftKey ? 20 : 5; // Hold shift to move faster
        let moved = false;

        switch (ev.key) {
          case "ArrowUp": {
            this._yOffset -= step;
            moved = true;

            break;
          }
          case "ArrowDown": {
            this._yOffset += step;
            moved = true;

            break;
          }
          case "ArrowLeft": {
            this._xOffset -= step;
            moved = true;
            break;
          }
          case "ArrowRight": {
            this._xOffset += step;
            moved = true;
            break;
          }
        }

        if (!moved) return;

        ev.preventDefault();

        this.updateTransform();
        this.checkBounds();
      },
      { signal }
    );
  }

  private _drag = (ev: PointerEvent) => {
    if (!this._isDragging) return;

    ev.preventDefault();

    this._currentX = ev.clientX - this._initialX;
    this._currentY = ev.clientY - this._initialY;

    this._xOffset = this._currentX;
    this._yOffset = this._currentY;

    this.updateTransform();
  };

  private _dragEnd = (ev: PointerEvent) => {
    this._isDragging = false;

    this._dragHandle.releasePointerCapture(ev.pointerId);

    this._initialX = this._currentX;
    this._initialY = this._currentY;

    this.checkBounds(); // Ensure it hasn't been dropped off-screen

    this._dragHandle.removeEventListener("pointermove", this._drag);
    this._dragHandle.removeEventListener("pointerup", this._dragEnd);
    this._dragHandle.removeEventListener("pointercancel", this._dragEnd);
  };

  private updateTransform() {
    this.style.setProperty("--x-offset", this._xOffset + "px");
    this.style.setProperty("--y-offset", this._yOffset + "px");
  }

  /* Boundary Awareness */
  private checkBounds() {
    const rect = this.getBoundingClientRect();
    const viewportHeight = window.innerHeight;
    const viewportWidth = window.innerWidth;

    // Add a 10px buffer from the edges
    const padding = 10;

    let adjusted = false;

    // Check Bottom
    if (rect.bottom > viewportHeight - padding) {
      this._yOffset -= rect.bottom - (viewportHeight - padding);
      adjusted = true;
    }
    // Check Top
    if (rect.top < padding) {
      this._yOffset += padding - rect.top;
      adjusted = true;
    }
    // Check Right
    if (rect.right > viewportWidth - padding) {
      this._xOffset -= rect.right - (viewportWidth - padding);
      adjusted = true;
    }
    // Check Left
    if (rect.left < padding) {
      this._xOffset += padding - rect.left;
      adjusted = true;
    }

    if (adjusted) {
      this.style.transition = "transform 0.2s ease-out";
      this.updateTransform();

      // Remove transition after adjustment so dragging stays instantaneous
      setTimeout(() => {
        this.style.transition = "";
      }, 200);
    }
  }

  /* Collapse Logic (Adapted) */
  private _togglePanel = () => {
    this._isExpanded = !this._isExpanded;
    this._toggleBtn.toggleAttribute("aria-expanded", this._isExpanded);
    this._toggleBtn.textContent = this._isExpanded ? "[\u2013]" : "[\u002b]";

    const onTransitionEnd = () => {
      if (this._isExpanded) this._panelContent.style.setProperty("height", "auto");
      this._panelContent.style.removeProperty("will-change");
      this._panelContent.removeEventListener("transitionend", onTransitionEnd);

      if (this._isExpanded) this.checkBounds(); // Recalibrate if expansion pushes it off-screen
    };

    if (this._isExpanded) {
      // Opening
      const scrollHeight = this._panelContent.scrollHeight;
      this._panelContent.style.removeProperty("height");
      this._panelContent.style.setProperty("--max-height", `${scrollHeight}px`);
      this._panelContent.style.setProperty("will-change", "height");

      // Small timeout ensures the browser registers the removal of 'height: 0px' before setting the variable
      requestAnimationFrame(() => {
        this._panelContent.style.setProperty("height", "var(--max-height)");
      });

      this._panelContent.addEventListener("transitionend", onTransitionEnd);
    } else {
      // Closing
      this._panelContent.style.setProperty("height", `${this._panelContent.scrollHeight}px`);
      // oxlint-disable-next-line @typescript-eslint/no-unused-expressions
      this._panelContent.offsetHeight; // Force Reflow

      this._panelContent.style.setProperty("will-change", "height");
      this._panelContent.style.setProperty("height", "0px");

      this._panelContent.addEventListener("transitionend", onTransitionEnd);
    }
  };

  /** Stop propagation */
  private _stopPropagation = <T extends Event>(ev: T) => {
    ev.stopPropagation();
  };

  /**
   * Execute tear-down and clean-up logic which couldn't be wired directly with the AbortSignal but
   * is still somehow affected/concerned by the abort event of the AbortSignal triggering.
   */
  private _onAbortSignalAborted = () => {
    this._dragHandle.addEventListener("pointermove", this._drag);
    this._dragHandle.addEventListener("pointerup", this._dragEnd);
    this._dragHandle.addEventListener("pointercancel", this._dragEnd);
  };

  private _initLayersReorder(signal: AbortSignal) {
    this.addEventListener(
      "pointerdown",
      (ev: PointerEvent) => {
        this._stopPropagation(ev);
        this._handleLayersReorderStart(ev);
      },
      { signal }
    );

    this.addEventListener(
      "pointermove",
      (ev: PointerEvent) => {
        this._stopPropagation(ev);
        this._handleLayersReorder(ev);
      },
      { signal }
    );

    this.addEventListener(
      "pointerup",
      (ev: PointerEvent) => {
        this._stopPropagation(ev);
        this._handleLayersReorderEnd(ev);
      },
      { signal }
    );

    this.addEventListener(
      "pointercancel",
      (ev: PointerEvent) => {
        this._stopPropagation(ev);
        this._handleLayersReorderEnd(ev);
      },
      { signal }
    );
  }

  private _handleLayersReorderStart(ev: PointerEvent) {
    const eventTarget = ev.target as HTMLElement | null;
    const draggedElement = eventTarget?.matches("layer-item")
      ? eventTarget
      : eventTarget?.closest("layer-item");
    const isLayerItem = draggedElement instanceof LayerItem;

    if (!isLayerItem || !draggedElement.requestedDragging) return;

    ev.preventDefault();

    this._draggedItem = draggedElement;
    this._isDraggingActive = false;

    this._dragStartPosX = ev.clientX;
    this._dragStartPosY = ev.clientY;
    this._dragPrevPosY = ev.clientY;
    this._dragCurrPosX = ev.clientX;
    this._dragCurrPosY = ev.clientY;

    this._draggedItem.style.setProperty("cursor", "grabbing");

    this._draggedItem.setPointerCapture(ev.pointerId);
  }

  private _handleLayersReorder(ev: PointerEvent) {
    if (!this._draggedItem) return;

    this._dragCurrPosX = ev.clientX;
    this._dragCurrPosY = ev.clientY;

    const deltaY = this._dragCurrPosY - this._dragStartPosY;
    const deltaX = this._dragCurrPosX - this._dragStartPosX;

    if (!this._isDraggingActive) {
      if (Math.hypot(deltaX, deltaY) < 3) return;

      this._isDraggingActive = true;

      const rect = this._draggedItem.getBoundingClientRect();
      const parentRect = this.getBoundingClientRect();

      this._dragInitialOffsetTop = rect.top - parentRect.top;

      const initialOffsetLeft = rect.left - parentRect.left;

      const computedTransition = getComputedStyle(this._draggedItem).transitionDuration;
      this._swapAnimDuration =
        parseFloat(computedTransition) * (computedTransition.includes("ms") ? 1 : 1000) || 150;

      this._dragPlaceholder = document.createElement("div");
      this._dragPlaceholder.className = "layer-placeholder";
      this._dragPlaceholder.style.width = `${rect.width}px`;
      this._dragPlaceholder.style.height = `${rect.height}px`;
      this._draggedItem.before(this._dragPlaceholder);

      this._draggedItem.style.width = `${rect.width}px`;
      this._draggedItem.style.height = `${rect.height}px`;
      this._draggedItem.style.top = `${this._dragInitialOffsetTop}px`;
      this._draggedItem.style.left = `${initialOffsetLeft}px`;
      this._draggedItem.classList.add("dragging");

      this._scrollAnimFrame = requestAnimationFrame(this._autoScroll);
    }

    this._draggedItem.style.top = `${this._dragInitialOffsetTop + deltaY}px`;

    const scrollParent = this._getScrollParent(this._draggedItem) || document.body;
    const scrollParentRect = scrollParent.getBoundingClientRect();

    if (this._dragCurrPosY < scrollParentRect.top + this._scrollThreshold) {
      this._scrollSpeed = -6;
    } else if (this._dragCurrPosY > scrollParentRect.bottom - this._scrollThreshold) {
      this._scrollSpeed = 6;
    } else {
      this._scrollSpeed = 0;
    }

    this._handleLayerIntersections();
  }

  private _handleLayersReorderEnd(ev: PointerEvent) {
    if (!this._draggedItem) return;

    this._draggedItem.style.removeProperty("cursor");

    if (this._draggedItem.hasPointerCapture(ev.pointerId))
      this._draggedItem.releasePointerCapture(ev.pointerId);

    if (this._isDraggingActive) {
      this._dragPlaceholder?.before(this._draggedItem);
      this._dragPlaceholder?.remove();

      this._draggedItem.style = "";
      this._draggedItem.classList.remove("dragging");

      cancelAnimationFrame(this._scrollAnimFrame!);

      this.dispatchEvent(new CustomEvent(LayerEvents.Reorder, { bubbles: true, composed: true }));
    }

    this._draggedItem = null;
    this._dragPlaceholder = null;
    this._isDraggingActive = false;
    this._scrollSpeed = 0;
  }

  private _handleLayerIntersections() {
    const isMovingDown = this._dragCurrPosY > this._dragPrevPosY;
    this._dragPrevPosY = this._dragCurrPosY;

    // Calculate visual center of dragged item
    const draggedRect = this._draggedItem!.getBoundingClientRect();
    const draggedCenterY = draggedRect.top + draggedRect.height / 2;

    // Get all valid items we can swap with
    const validItems = Array.from(this.querySelectorAll<LayerItem>("layer-item:not(.dragging)"));

    // Find the exact element the mouse is currently hovering over
    const hoverItem = validItems.find((item) => {
      const rect = item.getBoundingClientRect();
      return draggedCenterY >= rect.top && draggedCenterY <= rect.bottom;
    });

    if (hoverItem && hoverItem !== this._draggedItem) {
      const hoverRect = hoverItem.getBoundingClientRect();
      const targetCenterY = hoverRect.top + hoverRect.height / 2;

      if (isMovingDown && draggedCenterY > targetCenterY) {
        this._handleLayerAnimatedSwap(() => hoverItem.after(this._dragPlaceholder!));
      } else if (!isMovingDown && draggedCenterY < targetCenterY) {
        this._handleLayerAnimatedSwap(() => hoverItem.before(this._dragPlaceholder!));
      }
    }
  }

  private _handleLayerAnimatedSwap(swapAction: (...params: unknown[]) => unknown) {
    if (this._isSwapAnimInProgress) return;

    this._isSwapAnimInProgress = true;
    setTimeout(() => {
      this._isSwapAnimInProgress = false;
    }, this._swapAnimDuration);

    const layerItems = Array.from(this.querySelectorAll<LayerItem>("layer-item:not(.dragging)"));
    const firstPositions = layerItems.map((layerItem) => layerItem.getBoundingClientRect().top);

    swapAction();

    const lastPositions = layerItems.map((layerItem) => layerItem.getBoundingClientRect().top);

    layerItems.forEach((layerItem, index) => {
      const deltaY = firstPositions[index] - lastPositions[index];

      if (deltaY !== 0) {
        // Temporarily remove the transition to snap it back to the "First" position
        layerItem.style.transition = "none";
        layerItem.style.transform = `translateY(${deltaY}px)`;

        // Force the browser to recalculate layout
        layerItem.getBoundingClientRect();

        // Re-enable the bouncy transition and remove the transform so it glides home
        requestAnimationFrame(() => {
          layerItem.style.transition = ""; // Restores the bouncy transition from CSS
          layerItem.style.transform = "";
        });
      }
    });
  }

  /** Auto-scroll animation trigger + intersection checking under the hood. */
  private _autoScroll = () => {
    if (!this._draggedItem) return;

    if (this._scrollSpeed !== 0) {
      const scrollParent = this._getScrollParent(this._draggedItem) || document.body;
      scrollParent.scrollTop += this._scrollSpeed;
      this._handleLayerIntersections();
    }
    this._scrollAnimFrame = requestAnimationFrame(this._autoScroll);
  };

  /** Helper method to find the actual scrolling container dynamically */
  private _getScrollParent(node: HTMLElement | null): HTMLElement | null {
    if (node == null) return null;

    if (node.scrollHeight > node.clientHeight) {
      return node;
    } else {
      return this._getScrollParent(node.parentNode as HTMLElement);
    }
  }

  private _handlerLayerSelect = (ev: CustomEvent<LayerEventPayload<typeof LayerEvents.Select>>) => {
    const selectedElement = ev.detail;
    this._toggleSelectedLayer(selectedElement);

    const selectedEvent: CustomEvent<LayerEventPayload<typeof LayerEvents.Selected>> =
      new CustomEvent(LayerEvents.Selected, {
        bubbles: true,
        composed: true,
        detail: {
          id: selectedElement.uuid,
          name: selectedElement.name,
        },
      });

    this.dispatchEvent(selectedEvent);
  };

  private _toggleSelectedLayer(selected: LayerItem) {
    if (this._draggedItem === selected) return;

    this.querySelectorAll("layer-item").forEach((layer) => {
      layer.toggleAttribute("active", selected === layer);
    });
  }

  public addNewLayer({
    id,
    name,
    active = false,
    visible = true,
  }: {
    id: string;
    name?: string;
    active?: boolean;
    visible?: boolean;
  }) {
    const layer = document.createElement("layer-item");

    layer.uuid = id;
    if (name) layer.name = name;
    if (!visible) layer.visible = visible;

    this.append(layer);

    if (active) this._toggleSelectedLayer(layer);
  }
}
