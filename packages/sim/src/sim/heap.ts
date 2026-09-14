/** Kopiec binarny na parach (węzeł, koszt). Bez zależności, bez alokacji na push. */
export class MinHeap {
  private nodes: Int32Array;
  private costs: Float64Array;
  private count = 0;

  constructor(capacity = 64) {
    this.nodes = new Int32Array(Math.max(1, capacity));
    this.costs = new Float64Array(Math.max(1, capacity));
  }

  get size(): number { return this.count; }

  push(node: number, cost: number): void {
    if (this.count === this.nodes.length) this.grow();
    let i = this.count++;
    this.nodes[i] = node;
    this.costs[i] = cost;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.costs[parent] <= this.costs[i]) break;
      this.swap(parent, i);
      i = parent;
    }
  }

  pop(): number | undefined {
    if (this.count === 0) return undefined;
    const top = this.nodes[0];
    this.count--;
    if (this.count > 0) {
      this.nodes[0] = this.nodes[this.count];
      this.costs[0] = this.costs[this.count];
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let best = i;
        if (l < this.count && this.costs[l] < this.costs[best]) best = l;
        if (r < this.count && this.costs[r] < this.costs[best]) best = r;
        if (best === i) break;
        this.swap(best, i);
        i = best;
      }
    }
    return top;
  }

  private swap(a: number, b: number): void {
    const n = this.nodes[a]; this.nodes[a] = this.nodes[b]; this.nodes[b] = n;
    const c = this.costs[a]; this.costs[a] = this.costs[b]; this.costs[b] = c;
  }

  private grow(): void {
    const nodes = new Int32Array(this.nodes.length * 2);
    const costs = new Float64Array(this.costs.length * 2);
    nodes.set(this.nodes);
    costs.set(this.costs);
    this.nodes = nodes;
    this.costs = costs;
  }
}
