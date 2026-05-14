import axios from 'axios';
import { ServerHarness } from './helpers/serverHarness';

describe('Server Partition Enforcement', () => {
  let harness: ServerHarness;

  beforeEach(async () => {
    harness = await ServerHarness.create();
  });

  afterEach(async () => {
    await harness.close();
  });

  it('rejects cross-run spectator access with table_not_found', async () => {
    await harness.seatPlayer({
      tableId: 41,
      userId: 2001,
      username: 'run_b_player',
      stack: 200,
      seatNumber: 1,
      communityId: 12,
      tableName: 'Run B Table',
      isTestOnly: true,
      testRunTag: 'run-b',
    });

    const client = await harness.connectUser(
      { id: 1001, username: 'run_a_player', isTestUser: true, testRunTag: 'run-a' }
    );
    const errorPromise = harness.waitForSocketEvent<{ message?: string; code?: string }>(client, 'error');
    client.emit('spectate_table', { tableId: 41 });
    const errorPayload = await errorPromise;
    expect(errorPayload.message).toBe('table_not_found');
    expect(errorPayload.code).toBe('table_not_found');
    client.disconnect();
  });

  it('rejects test-user spectator access to normal tables', async () => {
    await harness.seatPlayer({
      tableId: 42,
      userId: 2002,
      username: 'normal_player',
      stack: 200,
      seatNumber: 1,
      communityId: 14,
      tableName: 'Normal Table',
      isTestOnly: false,
      testRunTag: null,
    });

    const client = await harness.connectUser(
      { id: 1002, username: 'test_user', isTestUser: true, testRunTag: 'run-a' }
    );
    const errorPromise = harness.waitForSocketEvent<{ message?: string; code?: string }>(client, 'error');
    client.emit('spectate_table', { tableId: 42 });
    const errorPayload = await errorPromise;
    expect(errorPayload.message).toBe('table_not_found');
    expect(errorPayload.code).toBe('table_not_found');
    client.disconnect();
  });

  it('purges test table runtime only when the run tag matches', async () => {
    await harness.seatPlayer({
      tableId: 43,
      userId: 2003,
      username: 'fixture_player',
      stack: 200,
      seatNumber: 1,
      communityId: 15,
      tableName: 'Fixture Table',
      isTestOnly: true,
      testRunTag: 'fixture-run',
    });

    const mismatch = await axios.post(`${harness.baseHttpUrl}/_internal/game/table_43/purge`, {
      expected_table_id: 43,
      expected_test_run_tag: 'wrong-run',
    }, {
      validateStatus: () => true,
    });
    expect(mismatch.status).toBe(409);

    const success = await axios.post(`${harness.baseHttpUrl}/_internal/game/table_43/purge`, {
      expected_table_id: 43,
      expected_test_run_tag: 'fixture-run',
    }, {
      validateStatus: () => true,
    });
    expect(success.status).toBe(200);
    expect(success.data.success).toBe(true);
  });
});
