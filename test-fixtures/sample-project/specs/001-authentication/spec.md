# Feature Specification: Authentication

## Overview

Registered users can sign in to the product and end their session when they are finished.

## Requirements

- **FR-001**: Login — Allow a registered user to authenticate with their email address and password.
- **FR-002**: Logout — Allow a signed-in user to end their session and clear the stored session token.

## Acceptance Scenarios

- Given a registered user, when they submit a valid email and password, then a session is created.
- Given a signed-in user, when they log out, then the session token is removed.
