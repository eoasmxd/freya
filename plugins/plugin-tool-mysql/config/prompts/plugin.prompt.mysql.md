MySQL database query toolbox.

Provides capabilities to execute standard read-only SQL SELECT queries and return structured JSON results.

Usage Guidelines:
1. Only SELECT queries are permitted. Any non-SELECT queries, DML modifications, or DDL destructive statements are strictly prohibited.
2. Never guess table or column names; formulate queries strictly based on verified schemas in context or skill guides.
3. Supports specifying the target connection name via `connection`. The default connection is used if omitted.
4. Result rows are subject to safety truncation limits; always consider using explicit `LIMIT` clauses.
