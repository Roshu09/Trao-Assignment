# AI Interview Prep Kit

Turns a job description and a company website into a personalised interview preparation kit:
company brief, role breakdown, question bank, flashcards and a day-by-day study schedule.

> Work in progress. This README is filled in as decisions are made. See the sections below.

## Stack

Next.js + Tailwind, Node.js + Express, MongoDB, TypeScript, Groq (LLM).

## Setup

```bash
npm install
cp .env.example .env   # then fill in the values
npm test
npm run typecheck
```

### Batch command

```bash
npm run evaluate -- --input <cases.json> --output <kits.json>
```

## To document (fill in as you build)

- [ ] LLM provider and model
- [ ] Architecture
- [ ] Retrieval approach and sources
- [ ] Research and generation steps
- [ ] Generated, edited and pinned state
- [ ] Schedule allocation
- [ ] Coverage loop and why it stops where it does
- [ ] Edge cases, duplicates and long generations
- [ ] Creative feature (if built)
- [ ] Trade-offs and known limitations
- [ ] Environment variables (see `.env.example`)
