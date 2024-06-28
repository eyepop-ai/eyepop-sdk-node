// src/__tests__/index.test.ts
import fetchMock from 'jest-fetch-mock';
import { Dataset, DatasetCreate, DatasetUpdate, ModelCreate, ModelUpdate, DatasetResponse, ModelResponse } from '../../src/eyepop-dataset';
import {describe, expect, test, beforeEach} from '@jest/globals'

const token = 'test-token';
const sdk = new Dataset(token);

describe('Dataset', () => {
  beforeEach(() => {
    fetchMock.resetMocks();
  });

  test('healthz', async () => {
    fetchMock.mockResponseOnce(JSON.stringify({ status: 'ok' }));

    const response = await sdk.healthz() as any;
    expect(response.status).toBe('ok');
    expect(fetchMock).toHaveBeenCalledWith('https://your-api-base-url.com/healthz', {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
    });
  });

  test('listDatasets', async () => {
    const account_uuid = 'test-account-uuid';
    const mockDatasets: DatasetResponse[] = [
      {
        uuid: 'dataset-uuid',
        name: 'Test Dataset',
        description: 'A test dataset',
        tags: ['test'],
        account_uuid: 'test-account-uuid',
        created_at: '2021-01-01T00:00:00Z',
        updated_at: '2021-01-01T00:00:00Z',
        versions: [],
      },
    ];
    fetchMock.mockResponseOnce(JSON.stringify(mockDatasets));

    const response = await sdk.listDatasets(account_uuid);
    expect(response).toEqual(mockDatasets);
    expect(fetchMock).toHaveBeenCalledWith(`https://your-api-base-url.com/datasets?account_uuid=${account_uuid}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
    });
  });

  // TODO: Add more tests for other methods here...

});
