# grokbuildhrproject

Full-stack HR / People Operations Platform (Educational)

**Purpose**: Upskill to mid-level SWE by building a realistic enterprise HR system using JS/React/Node/TypeScript/Postgres.

This project focuses on:
- Clean architecture and separation of concerns
- Robust APIs with proper design (pagination, filtering, RBAC)
- React frontend with modern patterns (TanStack Query, feature-based structure)
- Testing strategy (unit, integration, E2E considerations)
- Real-world enterprise concerns: workflows, auditing, permissions, data relationships

## Tech Stack
- Backend: Node.js + TypeScript + Express + Prisma + PostgreSQL
- Frontend: React + TypeScript + Vite + TanStack Query + Tailwind + React Router
- Auth: JWT + RBAC (Role-Based Access Control)
- Validation: Zod

## Domain
- Employees
- Departments
- Leave Requests (with approval workflow)
- Performance Reviews

## Structure
Similar layered backend (routes -> controllers -> services -> repositories)
Feature-based frontend.

See JOURNAL.md for thought process and PHASE_PLANS.md for roadmap.

All code has heavy comments explaining specific lines, decisions, interactions, and why choices were made for mid-level upskilling.
