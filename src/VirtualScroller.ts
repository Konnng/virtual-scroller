import { LitElement, PropertyValues, css, html } from 'lit'
import { customElement, property, state } from 'lit/decorators.js';
import { debounce, findLastIndex, isNil, last } from 'lodash-es'

import { repeat } from 'lit/directives/repeat.js';

@customElement('virtual-scroller')
export class VirtualScroller extends LitElement {
  static styles = css`
    :host {
      display: block;
      min-height: 300px;
      height: 100%;
      position: relative;
    }

    .virtual-scroller {
      position: absolute;
      border: 1px solid red;
      transform: translate3d(0, 0, 0);
      opacity: 0;
      width: 100%;
      height: 100%;
      overflow-y: auto;
    }

    .virtual-scroller--ready {
      opacity: 1;
    }

    .virtual-scroller__scroll-placeholder {
      display: block;
      height: 1px;
      opacity: 0;
      pointer-events: none;
      position: absolute;
      transition: top 0.2s;
      width: 1px;
    }

    .virtual-scroller__item {
      position: absolute;
      width: 100%;
      min-height: var(--scroller-item-minHeight, auto);
    }
  `;

  @property({ type: Array }) items = []
  @property({ type: Boolean }) hasMore = false
  @property({ type: Number }) minHeight = 50

  @state()
  private itemsMetadata: ScrollerItemMeta[] = []

  @state()
  private attachedRange: ScrollerRange = { start: 0, end: 0 }

  @state()
  private loadingItem: ScrollerLoading = { top: 0, height: 0 }

  @state()
  private isScrolling = false

  @state()
  private isReady = false

  private scrollerResizerObserver: Maybe<ResizeObserver> = null
  private nodeResizerObserver: Maybe<ResizeObserver> = null
  private visibilityObserver: Maybe<IntersectionObserver> = null

  private template: Maybe<HTMLTemplateElement> = null

  protected get attached() {
    const { start, end } =  this.attachedRange

    return this.itemsMetadata.slice(start, end + 1).map((meta, index) => ({ index, meta }))
  }

  protected get loading() {
    const { end } = this.attachedRange

    return this.hasMore && end >= this.items.length - 1
  }

  protected get _clientHeight() {
    return this.attached.reduce((acumulador, currentValue) => acumulador + currentValue.meta.height, 0)
  }

  protected get _scrollHeight() {
    const itemsHeight = this.itemsMetadata.reduce((acumulador, currentValue) => {
      return acumulador + (currentValue.height || this.minHeight)
    }, 0)
    const { height } = this.loadingItem

    return this.loading ? itemsHeight + height : itemsHeight
  }

  protected get accumulativeHeight() {
    return this.itemsMetadata.reduce((acumulador, currentValue: ScrollerItemMeta) => {
      const lastHeight = last(acumulador)
      const height = currentValue.height || this.minHeight

      if (!isNil(lastHeight)) {
        acumulador.push(lastHeight + height)
      }

      return acumulador
    }, [0])
  }

  private get element(): HTMLElement {
    return this.shadowRoot!.querySelector('.virtual-scroller')!
  }

  constructor() {
    super()
  }

  connectedCallback() {
    super.connectedCallback()

    this.init()
  }

  async attributeChangedCallback(name: string, v: string, ov: string) {}

  async updated(properties: PropertyValues) {
    if (properties.has('items')) {
      if (!this.hasMore && this.items.length !== this.itemsMetadata.length) {
        this.resetMetadata()

        this!.scrollTo(0, 0)
        await this.fillInitial()
      }
    }
    if (properties.has('minHeight')) {
      this.element.style.setProperty('--scroller-item-minHeight', `${this.minHeight}px`)
    }
  }

  // METHODS

  private async init() {
    if (this.isReady) {
      return
    }

    await this.tick()

    this.classList.add('virtual-scroller__scroller')
    this.element.style.setProperty('--scroller-item-minHeight', `${this.minHeight}px`)
    this.element.addEventListener('scroll', debounce(() => this.handleScroll(), 100), { passive: true })

    this.initTemplate()
    this.initObservers()

    this.resetMetadata()
  }

  private initTemplate() {
    const innerTemplate = this.shadowRoot?.querySelector('template')

    const element = document.createElement('div')
    element.style.setProperty('display', 'none')
    element.appendChild(innerTemplate?.content.cloneNode(true)!)

    this.shadowRoot?.appendChild(element)

    const slottedTemplate = element.querySelector('slot')?.assignedNodes().map(e => e.cloneNode(true))!
    const template = document.createElement('template')

    template.content.append(...slottedTemplate)

    element.remove()

    this.template = template
  }

  private initObservers() {
    this.scrollerResizerObserver = new ResizeObserver(entries => {
      entries.forEach(entry => {
        const { height } = entry.contentRect

        if (height && !this._scrollHeight) {
          this.updateMetadata()
        }

        if (height && height !== this._scrollHeight) {
          this.handleScroll()
        }
      })
    })
    this.nodeResizerObserver = new ResizeObserver(entries => {
      entries.forEach(entry => {
        const { height } = entry.contentRect

        if (!height) {
          return
        }

        const index = Number((entry.target as HTMLElement).dataset.index)
        const metadata = this.itemsMetadata[index]
        metadata.height = height

        this.itemsMetadata[metadata.index] = metadata
      })
    })
    this.visibilityObserver = new IntersectionObserver(async ([ { target } ]) => {
      if (target.classList.contains('virtual-scroller--ready')) {
        return
      }

      this.fillInitial()
      this.isReady = true
    })

    this.scrollerResizerObserver.observe(this)
    this.visibilityObserver.observe(this.element)
  }

  private updateMetadata() {
    const diff = this.items.length - this.itemsMetadata.length

    if (diff > 0) {
      this.itemsMetadata = this.itemsMetadata.concat(
        new Array(diff).fill(null).map((_, i): ScrollerItemMeta => ({
          index: this.itemsMetadata.length + i,
          height: 0,
          data: this.items[this.itemsMetadata.length + i]
        }))
      )
    }

    const { start, end } = this.attachedRange
    if (start === end) {
      return
    }

    const nodes = this.element.querySelectorAll(':scope > .virtual-scroller__item')

    if (this.nodeResizerObserver) {
      nodes.forEach(node => this.nodeResizerObserver!.observe(node))
    }

    for (let i = start; i <= end; i++) {
      const meta = this.itemsMetadata[i]
      const node = nodes[i - this.attachedRange.start] as HTMLElement

      if (!node) {
        return
      }

      meta.height = node.offsetHeight
      meta.data = this.items[i]

      this.itemsMetadata[i] = meta
    }
  }

  private resetMetadata() {
    this.attachedRange = { start: 0, end: 0 }
    this.itemsMetadata = this.items.map((item, index) => ({
      index,
      height: 0,
      data: item
    }))
  }

  private fill(start: number, end: number) {
    const starRange = Math.max(0, start)
    const endRange = Math.min(end, Math.max(0, this.items.length - 1))

    this.attachedRange = { start: starRange, end: endRange }

    if (this.items.length) {
      this.updateMetadata()
    }

    if (end >= this.items.length && this.hasMore) {
      this.dispatch('load-more', this.items.length)
    }
  }

  private async fillInitial() {
    this.fill(this.attachedRange.start, this.attachedRange.end + 1)
    await this.tick()

    if (this.attached.length < this.items.length && this.element.clientHeight > this._clientHeight) {
      this.fillInitial()
    }
  }

  private getVisibleItems(): ScrollerVisibleItems {
    const { scrollTop, offsetHeight } = this.element

    const first = findLastIndex(this.accumulativeHeight, item => item <= scrollTop)
    const last = findLastIndex(this.accumulativeHeight, item => item <= scrollTop + offsetHeight)

    return { first, last }
  }

  private async handleScroll() {
    if (!this.isScrolling) {
      this.isScrolling = true
      this.dispatch('scrolled')

      await this.tick()
      this.isScrolling = false

      const { first, last } = this.getVisibleItems()
      this.fill(first, last)
    }
  }

  private dispatch(event: String, data: unknown = null) {
    this.dispatchEvent(new CustomEvent<typeof data>('event', { detail: data ?? undefined }))
  }

  private async tick(): Promise<void> {
    return new Promise(resolve => {
      requestAnimationFrame(() => resolve())
    })
  }

  renderItemTemplate(data: unknown = {}) {
    const rawTemplate = this.template?.innerHTML.trim()
    const renderFn = new Function('html', 'data', 'scope', 'return html`' + rawTemplate + '`;');

    return html`${renderFn(html, data, this)}`
  }

  renderItems() {
    return repeat(this.attached, ({ index }) => index, (item) => {
      const { meta: { index, data } } = item
      const top = this.accumulativeHeight[index]
      const matrix3d = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, top, 0, 1]


      return html`
      <div data-index="${index}" class="virtual-scroller__item" style="transform: matrix3d(${matrix3d.join(',')})">
        ${this.renderItemTemplate(data)}
      </div>
      `
    })
  }

  renderLoading() {
    if (!this.loading) {
      return ''
    }

    return html`
      <div class="virtual-scroller__item virtual-scroller__item--placeholder" style="transform: translate3d(0, ${this.loadingItem.top}px, 0)">
        <slot name="loading">loading...</slot>
      </div>
    `
  }

  render() {
    const elementClass = [
      'virtual-scroller'
    ]

    if (this.isReady) {
      elementClass.push('virtual-scroller--ready')
    }

    return html`
      <div class="${elementClass.join(' ')}">
        ${this.renderItems()}
        ${this.renderLoading()}
        <div class="virtual-scroller__scroll-placeholder" style="transform: translate3d(0, ${this._scrollHeight}px, 0)"></div>

        <template>
          <slot></slot>
        </template>
      </div>
    `;
  }
}
