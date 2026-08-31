// src/routes/changeMoves.test.js — Endpoints for booked change moves.

jest.mock('./relayBridge', () => ({ getBridgeStatus: jest.fn(), submitRelayRequest: jest.fn() }));
jest.mock('../services/changeMoveScheduler', () => ({
  readBookings: jest.fn(() => []),
  addBooking: jest.fn(),
  removeBooking: jest.fn(() => []),
  runDueChangeMoves: jest.fn(),
}));

const express = require('express');
const request = require('supertest');

const relayBridge = require('./relayBridge');
const { readBookings, addBooking, removeBooking, runDueChangeMoves } = require('../services/changeMoveScheduler');
const createChangeMovesRouter = require('./changeMoves');

/** An app with the router mounted. */
function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(createChangeMovesRouter());
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
  readBookings.mockReturnValue([]);
});

describe('GET /api/change-moves/my-changes', () => {
  it('flattens ServiceNow display-value records into pickable changes', async () => {
    relayBridge.getBridgeStatus.mockReturnValue(true);
    relayBridge.submitRelayRequest.mockResolvedValue({
      result: [{
        number: { value: 'CHG0046897', display_value: 'CHG0046897' },
        short_description: { value: 'Deploy', display_value: 'Deploy' },
        state: { value: '-2', display_value: 'Scheduled' },
        start_date: { value: '2026-08-31 09:00:00', display_value: '31/08/2026 09:00:00' },
      }],
    });

    const response = await request(buildApp()).get('/api/change-moves/my-changes');

    expect(response.body.changes).toEqual([{
      number: 'CHG0046897', shortDescription: 'Deploy',
      stateValue: '-2', stateLabel: 'Scheduled', plannedStart: '31/08/2026 09:00:00',
    }]);
  });

  it('scopes the list to the signed-in user, never the whole instance', async () => {
    relayBridge.getBridgeStatus.mockReturnValue(true);
    relayBridge.submitRelayRequest.mockResolvedValue({ result: [] });

    await request(buildApp()).get('/api/change-moves/my-changes');

    expect(relayBridge.submitRelayRequest.mock.calls[0][1].url)
      .toContain(encodeURIComponent('assigned_to=javascript:gs.getUserID()'));
  });

  it('says the relay is closed rather than failing, so the panel can explain an empty picker', async () => {
    relayBridge.getBridgeStatus.mockReturnValue(false);

    const response = await request(buildApp()).get('/api/change-moves/my-changes');

    expect(response.status).toBe(200);
    expect(response.body.changes).toEqual([]);
    expect(response.body.message).toMatch(/not registered/i);
  });
});

describe('POST /api/change-moves/bookings', () => {
  it('books a move', async () => {
    addBooking.mockReturnValue({ id: 'booking-1', changeNumber: 'CHG1' });

    const response = await request(buildApp())
      .post('/api/change-moves/bookings')
      .send({ changeNumber: 'CHG1', targetState: '1', dueAtIso: '2026-08-31T09:00:00Z' });

    expect(response.status).toBe(200);
    expect(response.body.booking.id).toBe('booking-1');
  });

  it('refuses a booking that could never run, rather than storing false cover', async () => {
    addBooking.mockReturnValue(null);

    const response = await request(buildApp()).post('/api/change-moves/bookings').send({ changeNumber: '' });

    expect(response.status).toBe(400);
    expect(response.body.message).toMatch(/needs a change, a target state and a date and time/i);
  });
});

describe('DELETE /api/change-moves/bookings/:bookingId', () => {
  it('withdraws the booking and returns what is left', async () => {
    removeBooking.mockReturnValue([{ id: 'booking-2' }]);

    const response = await request(buildApp()).delete('/api/change-moves/bookings/booking-1');

    expect(removeBooking).toHaveBeenCalledWith('booking-1');
    expect(response.body.bookings).toHaveLength(1);
  });
});

describe('POST /api/change-moves/run-now', () => {
  it('returns what the run did', async () => {
    runDueChangeMoves.mockResolvedValue({ movedChangeNumbers: ['CHG1'], failures: [], skipReason: '', dueCount: 1 });

    const response = await request(buildApp()).post('/api/change-moves/run-now').send({});

    expect(response.status).toBe(200);
    expect(response.body.run.movedChangeNumbers).toEqual(['CHG1']);
  });

  it('answers 200 with the reason when a closed relay stopped it', async () => {
    runDueChangeMoves.mockResolvedValue({
      movedChangeNumbers: [], failures: [], dueCount: 1,
      skipReason: 'The ServiceNow relay bookmarklet is not registered, so 1 due move(s) are still waiting.',
    });

    const response = await request(buildApp()).post('/api/change-moves/run-now').send({});

    expect(response.status).toBe(200);
    expect(response.body.run.skipReason).toMatch(/still waiting/);
  });
});
