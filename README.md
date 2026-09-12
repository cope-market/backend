# Cope Market — Backend

API and services for [Cope Market](https://github.com/cope-market/cope-market): a social trading app
on Arc, where positions are oracle-priced synthetics against an LP pool.

- **Contracts:** [cope-market/contracts](https://github.com/cope-market/contracts)
- **Integration reference for clients:** [`INTEGRATION.md`](https://github.com/cope-market/cope-market/blob/main/INTEGRATION.md)
- **Plan:** [`PLAN.md`](./PLAN.md)

## Develop

```bash
npm install
npm test
npm run typecheck
npm run lint
npm run dev
```

## What this service does, and does not

The frontend reads the chain directly wherever it can. This API covers only what the chain cannot
answer: social content, data that needs a server such as tweet embeds and ranked feeds, and the
catalogue that turns a `bytes32` feed id into a symbol.
