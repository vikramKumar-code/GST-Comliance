import client from './client';

export const listBills = (params = {}) => client.get('/bills', { params });
export const getBill = (id) => client.get(`/bills/${id}`);
export const createBill = (data) => client.post('/bills', data);
export const updateBill = (id, data) => client.put(`/bills/${id}`, data);
export const deleteBill = (id) => client.delete(`/bills/${id}`);
