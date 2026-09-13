import { useNavigate } from '../router';
import { history } from '../services/storage';

export default function ProfilePage() {
  const navigate = useNavigate();
  return <><h1 className="page-title">Profile</h1><div className="status">Favorites and history are stored privately on this device. Backend credentials are never sent to the browser.</div><button className="secondary-button" onClick={() => navigate('/history')}>🕘 Watch History</button><button className="secondary-button" onClick={() => navigate('/favorites')}>❤️ Favorites</button></>;
}
