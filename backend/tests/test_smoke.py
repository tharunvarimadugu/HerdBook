import unittest

from app import create_app
from database.db import db


class SmokeTestCase(unittest.TestCase):
    def setUp(self):
        self.app = create_app('testing')
        self.client = self.app.test_client()
        with self.app.app_context():
            db.drop_all()
            db.create_all()

    def tearDown(self):
        with self.app.app_context():
            db.session.remove()
            db.drop_all()
            db.engine.dispose()

    def create_cow(self, **overrides):
        payload = {
            'ear_tag': 'TAG-1001',
            'breed': 'holstein',
            'birth_date': '2020-03-15',
            'status': 'milking',
            'name': 'Bessie',
            'current_lactation_number': 1,
            'current_lactation_start_date': '2024-01-15'
        }
        payload.update(overrides)
        response = self.client.post('/api/v1/herd/cows', json=payload)
        self.assertEqual(response.status_code, 201)
        return response.get_json()['data']

    def test_health_endpoint(self):
        response = self.client.get('/health')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json()['status'], 'healthy')

    def test_cow_creation_persists_lactation_fields(self):
        cow = self.create_cow()
        self.assertEqual(cow['current_lactation_number'], 1)
        self.assertEqual(cow['current_lactation_start_date'], '2024-01-15')

    def test_milk_record_inherits_lactation(self):
        cow = self.create_cow()
        response = self.client.post('/api/v1/milk/records', json={
            'cow_id': cow['id'],
            'record_date': '2024-02-01',
            'morning_milk': 10,
            'evening_milk': 12
        })
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.get_json()['data']['lactation_number'], 1)

    def test_calving_advances_lactation(self):
        cow = self.create_cow(current_lactation_number=1)
        response = self.client.post('/api/v1/reproduction/calving', json={
            'cow_id': cow['id'],
            'event_date': '2024-10-01',
            'calf_gender': 'female'
        })
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.get_json()['data']['lactation_number'], 2)

        details = self.client.get(f"/api/v1/herd/cows/{cow['id']}").get_json()['data']
        self.assertEqual(details['current_lactation_number'], 2)
        self.assertEqual(details['current_lactation_start_date'], '2024-10-01')

    def test_feed_cost_recalculation_handles_null_cost(self):
        response = self.client.post('/api/v1/feed/records', json={
            'feed_date': '2024-03-01',
            'feed_type': 'hay',
            'quantity': 5,
            'cost_per_unit': 2
        })
        self.assertEqual(response.status_code, 201)
        record_id = response.get_json()['data']['id']

        response = self.client.put(f'/api/v1/feed/records/{record_id}', json={
            'cost_per_unit': None
        })
        self.assertEqual(response.status_code, 200)
        self.assertIsNone(response.get_json()['data']['total_cost'])


if __name__ == '__main__':
    unittest.main()
